import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditStatus, Gender, Prisma } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, KV_CACHE, KvCache, STORAGE, StorageProvider } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { ProfileService } from '../profile/profile.service';

interface FeedWeightsCfg {
  sameCity: number;
  sameDistrict: number;
  eduMatch: number;
  incomeOverlap: number;
  active7d: number;
  fresh48h: number;
  maritalVerified: number;
  maritalUnverified: number;
}

interface CandidateRow {
  id: bigint;
  matchNo: string;
  gender: Gender;
  birthYear: number;
  heightCm: number;
  education: string;
  occupation: string;
  incomeRange: string;
  housing: string;
  car: string;
  residenceCity: string;
  residenceDistrict: string | null;
  intro: string | null;
  photos: Prisma.JsonValue;
  isMaritalVerified: boolean;
  publishedAt: Date | null;
  owner: { id: bigint; nickname: string; memberLevel: string; avatarKey: string | null; updatedAt: Date };
}

const FEED_TTL_SECONDS = 300; // 结果按 (activeProfileId, date) 缓存 5min（ARCHITECTURE §feed）

/**
 * 推荐流（PRD §6.2，D4）：硬过滤（性别相反/已发布/年龄窗/拉黑互斥/历史轮换移出）
 * → 规则分（权重全读 feed_weights，红线 I1）50% 坑位 + 随机 50% 坑位 → 当日轮换卡打"仅今日"标。
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(KV_CACHE) private readonly cache: KvCache,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  async list(userId: bigint, page: number, size: number) {
    const ordered = await this.buildOrder(userId);
    const slice = ordered.slice((page - 1) * size, page * size);
    if (slice.length === 0) return { total: ordered.length, page, size, items: [] };
    const rows = await this.candidatesByIds(slice.map((s) => s.profileId));
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const items = await Promise.all(
      slice.map(async (s) => this.toCard(byId.get(String(s.profileId))!, s.todayOnly, false)),
    );
    return { total: ordered.length, page, size, items };
  }

  /** 历史推荐（D4/用例 8）：被轮换档案可找回且仍可解锁 */
  async history(userId: bigint, page: number, size: number) {
    void userId;
    const where = { profile: { auditStatus: AuditStatus.APPROVED, publishedAt: { not: null }, isActive: true } };
    const [total, marks] = await Promise.all([
      this.prisma.feedRotationCard.count({ where }),
      this.prisma.feedRotationCard.findMany({ where, include: { profile: { include: { owner: true } } }, orderBy: [{ day: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    const items = await Promise.all(
      marks.map(async (m) => ({
        ...(await this.toCard(m.profile as unknown as CandidateRow, false, true)),
        rotatedOn: m.day.toISOString().slice(0, 10),
      })),
    );
    return { total, page, size, items };
  }

  /** 当日轮换集生成（定时任务 00:05 + 测试直调）：未打标记的上线档案中随机选 rotation_ratio% */
  async generateDailyRotation(): Promise<number> {
    const cfg = await this.config.get<{ percent: number }>(ConfigKeys.ROTATION_RATIO);
    const today = this.todayDate();
    const marked = await this.prisma.feedRotationCard.findMany({ where: { day: { lte: today } }, select: { profileId: true } });
    const markedIds = marked.map((m) => m.profileId);
    const eligible = await this.prisma.profile.findMany({
      where: { auditStatus: AuditStatus.APPROVED, publishedAt: { not: null }, isActive: true, ...(markedIds.length ? { id: { notIn: markedIds } } : {}) },
      select: { id: true },
    });
    const take = Math.round((eligible.length * cfg.percent) / 100);
    if (take === 0) return 0;
    const picked = this.shuffle(eligible).slice(0, take);
    await this.prisma.feedRotationCard.createMany({ data: picked.map((p) => ({ profileId: p.id, day: today })), skipDuplicates: true });
    this.logger.log(`轮换集生成 day=${today.toISOString().slice(0, 10)} count=${picked.length}`);
    return picked.length;
  }

  /** 过期轮换标记清理（可选治理，保留 90 天内可找回） */
  async pruneRotationMarks(before: Date): Promise<number> {
    const r = await this.prisma.feedRotationCard.deleteMany({ where: { day: { lt: before } } });
    return r.count;
  }

  // ==================== 私有 ====================

  /** 排序结果（profileId+todayOnly）按 (生效档案, date) 缓存；并发重复构建可接受（幂等） */
  private async buildOrder(userId: bigint): Promise<Array<{ profileId: string; todayOnly: boolean }>> {
    const my = await this.profile.getActiveProfileRaw(userId);
    if (!my) throw new BusinessException(400, 'NEED_ACTIVE_PROFILE', '请先创建并生效你的档案');
    const key = `feed:${my.id}:${this.todayDate().toISOString().slice(0, 10)}`;
    const cached = await this.cache.get(key);
    if (cached) return JSON.parse(cached) as Array<{ profileId: string; todayOnly: boolean }>;

    const [ageWin, rand, w] = await Promise.all([
      this.config.get<{ minAge: number; maxAge: number; diffYears: number }>(ConfigKeys.AGE_WINDOW),
      this.config.get<{ percent: number }>(ConfigKeys.RANDOM_RATIO),
      this.config.get<FeedWeightsCfg>(ConfigKeys.FEED_WEIGHTS),
    ]);

    // 硬过滤（§6.2）：性别相反、年龄窗（成年 + 与生效档案 ±diff）、拉黑互斥、昨日及更早轮换移出
    const year = new Date().getFullYear();
    const minBy = Math.max(year - ageWin.maxAge, my.birthYear - ageWin.diffYears);
    const maxBy = Math.min(year - ageWin.minAge, my.birthYear + ageWin.diffYears);
    const black = await this.prisma.blacklist.findMany({ where: { OR: [{ userId }, { blockedUserId: userId }] } });
    const excludeOwners = new Set<string>([String(userId), ...black.map((b) => String(b.userId === userId ? b.blockedUserId : b.userId))]);
    const today = this.todayDate();
    const outOfFeed = await this.prisma.feedRotationCard.findMany({ where: { day: { lt: today } }, select: { profileId: true } });
    const rotToday = await this.prisma.feedRotationCard.findMany({ where: { day: { equals: today } }, select: { profileId: true } });
    const rotTodaySet = new Set(rotToday.map((r) => String(r.profileId)));

    const candidates = await this.prisma.profile.findMany({
      where: {
        ownerUserId: { notIn: [...excludeOwners].map(BigInt) },
        gender: my.gender === Gender.FEMALE ? Gender.MALE : Gender.FEMALE,
        birthYear: { gte: minBy, lte: maxBy },
        isActive: true,
        auditStatus: AuditStatus.APPROVED,
        publishedAt: { not: null },
        ...(outOfFeed.length ? { id: { notIn: outOfFeed.map((o) => o.profileId) } } : {}),
      },
      include: { owner: { select: { id: true, nickname: true, memberLevel: true, avatarKey: true, updatedAt: true } } },
    }) as unknown as CandidateRow[];

    const scored = candidates
      .map((c) => ({ id: c.id, score: this.score(c, my, w) }))
      .sort((a, b) => Number(b.score - a.score));

    // 坑位：规则分 (100-random%) 在前，纯随机补足（D4 50/50）
    const n = scored.length;
    const randomLen = n <= 1 ? 0 : Math.round((n * rand.percent) / 100);
    const ruleIds = scored.slice(0, n - randomLen).map((s) => String(s.id));
    const randomIds = this.shuffle(scored.slice(n - randomLen)).map((s) => String(s.id));
    const order = [...ruleIds, ...randomIds].map((profileId) => ({ profileId, todayOnly: rotTodaySet.has(profileId) }));

    await this.cache.set(key, JSON.stringify(order), FEED_TTL_SECONDS);
    return order;
  }

  private score(c: CandidateRow, my: { residenceCity: string; residenceDistrict: string | null; education: string; incomeRange: string; publishedAt: Date | null }, w: FeedWeightsCfg): number {
    let s = 0;
    if (c.residenceCity === my.residenceCity) s += w.sameCity;
    if (my.residenceDistrict && c.residenceDistrict === my.residenceDistrict) s += w.sameDistrict;
    if (c.education === my.education) s += w.eduMatch;
    if (c.incomeRange === my.incomeRange && c.incomeRange !== 'UNDISCLOSED') s += w.incomeOverlap;
    if (c.owner.updatedAt.getTime() > Date.now() - 7 * 864e5) s += w.active7d;
    if (c.publishedAt && c.publishedAt.getTime() > Date.now() - 48 * 3600_000) s += w.fresh48h;
    s += c.isMaritalVerified ? w.maritalVerified : w.maritalUnverified;
    return s;
  }

  private async candidatesByIds(ids: string[]): Promise<CandidateRow[]> {
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: ids.map(BigInt) } },
      include: { owner: { select: { id: true, nickname: true, memberLevel: true, avatarKey: true, updatedAt: true } } },
    });
    return rows as unknown as CandidateRow[];
  }

  /** 卡片字段与 §5.3 完全一致：性别+出生年、会员徽章、婚姻核验标(绿/灰)、现居、身高、学历、职业、收入、房车、评语摘要、打码头像 */
  private async toCard(c: CandidateRow, todayOnly: boolean, history: boolean): Promise<Record<string, unknown>> {
    const [copy] = [await this.config.get<{ rotationCardTipEnabled?: boolean; rotationCardTip?: string }>(ConfigKeys.COPYWRITING)];
    const avatarKey = c.owner.avatarKey ?? this.firstPhotoKey(c.photos);
    return {
      profileId: c.id.toString(),
      matchNo: c.matchNo,
      gender: c.gender,
      birthYear: c.birthYear,
      heightCm: c.heightCm,
      education: c.education,
      occupation: c.occupation,
      incomeRange: c.incomeRange,
      housing: c.housing,
      car: c.car,
      residenceCity: c.residenceCity,
      residenceDistrict: c.residenceDistrict,
      introDigest: c.intro ? c.intro.slice(0, 40) : null,
      memberBadge: c.owner.memberLevel === 'PAID' || c.owner.memberLevel === 'TRIAL',
      maritalVerified: c.isMaritalVerified, // 绿/灰标由前端按此布尔渲染（§6.3）
      avatarUrl: avatarKey ? await this.storage.signedUrl(avatarKey, 600) : null,
      todayOnly: todayOnly && !history,
      rotationTip: todayOnly && !history && copy.rotationCardTipEnabled ? copy.rotationCardTip ?? null : null,
      unlocked: false, // 已有 active 解锁关系时由前端 check 接口确认（§6.1 放行不扣费）
    };
  }

  private firstPhotoKey(photos: Prisma.JsonValue): string | null {
    if (!Array.isArray(photos)) return null;
    const sorted = [...photos].sort((a, b) => Number((a as { sort?: number }).sort ?? 0) - Number((b as { sort?: number }).sort ?? 0));
    return (sorted[0] as { objectKey?: string })?.objectKey ?? null;
  }

  /** 本地日历“今天”0 点，但必须按 UTC 零点构造：@db.Date 写入取 UTC 日期部分，
   * 过滤参数会被序列化为带时刻的 datetime——若用本地零点（UTC+8 时 UTC 仍是昨天 16:00），
   * 会把当日标记误判为 day<today（实测 bug），UTC 零点两侧才一致。 */
  private todayDate(): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i] as T;
      a[i] = a[j] as T;
      a[j] = tmp;
    }
    return a;
  }
}
