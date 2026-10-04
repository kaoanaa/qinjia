import { Inject, Injectable } from '@nestjs/common';
import { AuditStatus, Gender, Prisma, UnlockStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, STORAGE, StorageProvider } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';

const BLUR_PROCESS = 'imageMogr2/blur/r_30';
const WALL_TYPES = ['viewed-me', 'favorited-me', 'unlocked-me'] as const;
const RECORD_TYPES = ['view', 'favorite', 'unlock'] as const;

type WallType = (typeof WALL_TYPES)[number];
type RecordType = (typeof RECORD_TYPES)[number];

interface CardOwnerRow {
  id: bigint;
  nickname: string;
  memberLevel: string;
  avatarKey: string | null;
  cityOnlyVisible: boolean;
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
  residenceCity: string;
  residenceDistrict: string | null;
  intro: string | null;
  photos: Prisma.JsonValue;
  isMaritalVerified: boolean;
  owner: CardOwnerRow;
}

/**
 * 三大付费墙 + 三记录 + 精准搜索（PRD §5.7/§5.8，P1，Step 16）。
 * 墙规则：非会员列表模糊（昵称掩码 + 头像强模糊），会员（memberLevel≠NONE，§5.9 权益矩阵）可见完整列表；
 * 记录页为本人行为历史，不设会员墙。搜索尊重目标「仅同城可见」开关（§5.8 隐私）。
 */
@Injectable()
export class WallService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  // ==================== 三大墙 ====================

  async wall(userId: bigint, wallType: string) {
    if (!WALL_TYPES.includes(wallType as WallType)) throw new BusinessException(400, 'BAD_WALL_TYPE', 'wallType 仅支持 viewed-me/favorited-me/unlocked-me');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { memberLevel: true } });
    const isMemberVisible = me.memberLevel !== 'NONE';
    const myProfile = await this.activeProfile(userId);

    let profileIds: bigint[]; // 互动发起者的档案归属用户 id
    if (wallType === 'unlocked-me') {
      const rows = await this.prisma.unlockRecord.findMany({ where: { targetProfileId: myProfile.id, status: UnlockStatus.ACTIVE }, select: { initiatorUserId: true } });
      profileIds = rows.map((r) => r.initiatorUserId);
    } else if (wallType === 'viewed-me') {
      const rows = await this.prisma.viewRecord.findMany({ where: { toProfileId: myProfile.id }, select: { fromUserId: true }, orderBy: { updatedAt: 'desc' } });
      profileIds = rows.map((r) => r.fromUserId);
    } else {
      const rows = await this.prisma.favoriteRecord.findMany({ where: { toProfileId: myProfile.id }, select: { fromUserId: true }, orderBy: { createdAt: 'desc' } });
      profileIds = rows.map((r) => r.fromUserId);
    }

    // 墙卡片展示对应用户的「生效档案」；无生效档案的互动者不展示
    const cards = profileIds.length ? await this.cardsOfActiveProfilesOfUsers([...new Set(profileIds.map(String))].map(BigInt), !isMemberVisible) : [];
    return { isMemberVisible, total: cards.length, items: cards };
  }

  // ==================== 三记录 ====================

  async records(userId: bigint, recordType: string, page: number, size: number) {
    if (!RECORD_TYPES.includes(recordType as RecordType)) throw new BusinessException(400, 'BAD_RECORD_TYPE', 'recordType 仅支持 view/favorite/unlock');
    const paging = { skip: (page - 1) * size, take: size };
    let rows: Array<{ toProfileId?: bigint; target?: { id: bigint }; targetProfileId?: bigint }>;
    let total: number;
    if (recordType === 'view') {
      const where = { fromUserId: userId };
      [rows, total] = await Promise.all([this.prisma.viewRecord.findMany({ where, ...paging, orderBy: { updatedAt: 'desc' } }), this.prisma.viewRecord.count({ where })]);
    } else if (recordType === 'favorite') {
      const where = { fromUserId: userId };
      [rows, total] = await Promise.all([this.prisma.favoriteRecord.findMany({ where, ...paging, orderBy: { createdAt: 'desc' } }), this.prisma.favoriteRecord.count({ where })]);
    } else {
      const where = { initiatorUserId: userId };
      const found = await this.prisma.unlockRecord.findMany({ where, ...paging, orderBy: { createdAt: 'desc' }, include: { target: { select: { id: true } } } });
      rows = found;
      total = await this.prisma.unlockRecord.count({ where });
    }
    const items = await this.cardsByProfileIds(rows.map((r) => r.target?.id ?? r.toProfileId ?? r.targetProfileId!).filter(Boolean));
    return { total, items };
  }

  // ==================== 精准搜索 ====================

  async search(
    userId: bigint,
    f: { city?: string; ageMin?: number; ageMax?: number; heightMin?: number; heightMax?: number; education?: string; incomeRange?: string; gender?: string; page: number; size: number },
  ) {
    const myProfile = await this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true }, select: { residenceCity: true } });
    const viewerCity = myProfile?.residenceCity ?? null;

    const black = await this.prisma.blacklist.findMany({ where: { OR: [{ userId }, { blockedUserId: userId }] } });
    const excludeOwners = new Set<string>([String(userId), ...black.map((b) => String(b.userId === userId ? b.blockedUserId : b.userId))]);

    const year = new Date().getFullYear();
    const where: Prisma.ProfileWhereInput = {
      isActive: true,
      auditStatus: AuditStatus.APPROVED,
      publishedAt: { not: null },
      ownerUserId: { notIn: [...excludeOwners].map(BigInt) },
      ...(f.city ? { residenceCity: f.city } : {}),
      ...(f.ageMin != null ? { birthYear: { lte: year - f.ageMin, ...(f.ageMax != null ? { gte: year - f.ageMax } : {}) } } : f.ageMax != null ? { birthYear: { gte: year - f.ageMax } } : {}),
      ...(f.heightMin != null || f.heightMax != null ? { heightCm: { ...(f.heightMin != null ? { gte: f.heightMin } : {}), ...(f.heightMax != null ? { lte: f.heightMax } : {}) } } : {}),
      ...(f.education ? { education: f.education as never } : {}),
      ...(f.incomeRange ? { incomeRange: f.incomeRange as never } : {}),
      ...(f.gender ? { gender: f.gender as Gender } : {}),
      // 「仅同城可见」开关（§5.8）：开启的目标档案仅同城访问者可见
      OR: [{ owner: { cityOnlyVisible: false } }, ...(viewerCity ? [{ residenceCity: viewerCity }] : [])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (f.page - 1) * f.size,
        take: f.size,
        include: { owner: { select: { id: true, nickname: true, memberLevel: true, avatarKey: true, cityOnlyVisible: true } } },
      }),
      this.prisma.profile.count({ where }),
    ]);
    return { total, items: await Promise.all(rows.map((r) => this.toCard(r as unknown as CandidateRow, false))) };
  }

  // ==================== 私有 ====================

  private async activeProfile(userId: bigint) {
    const p = await this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true, auditStatus: AuditStatus.APPROVED, publishedAt: { not: null } } });
    if (!p) throw new BusinessException(400, 'NEED_ACTIVE_PROFILE', '请先创建并生效你的档案');
    return p;
  }

  /** 指定用户们的生效档案卡片（墙用；blur=true 时昵称掩码+头像强模糊） */
  private async cardsOfActiveProfilesOfUsers(userIds: bigint[], blur: boolean) {
    if (!userIds.length) return [];
    const rows = await this.prisma.profile.findMany({
      where: { ownerUserId: { in: userIds }, isActive: true, auditStatus: AuditStatus.APPROVED, publishedAt: { not: null } },
      include: { owner: { select: { id: true, nickname: true, memberLevel: true, avatarKey: true, cityOnlyVisible: true } } },
    });
    return Promise.all(rows.map((r) => this.toCard(r as unknown as CandidateRow, blur)));
  }

  private async cardsByProfileIds(ids: bigint[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.profile.findMany({
      where: { id: { in: ids } },
      include: { owner: { select: { id: true, nickname: true, memberLevel: true, avatarKey: true, cityOnlyVisible: true } } },
    });
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return Promise.all(ids.map((id) => byId.get(String(id))).filter(Boolean).map((r) => this.toCard(r as unknown as CandidateRow, false)));
  }

  private async toCard(c: CandidateRow, blur: boolean): Promise<Record<string, unknown>> {
    const avatarKey = c.owner.avatarKey ?? this.firstPhotoKey(c.photos);
    return {
      profileId: c.id.toString(),
      matchNo: c.matchNo,
      nickname: blur ? maskNickname(c.owner.nickname) : c.owner.nickname, // 非会员模糊（§5.7）
      gender: c.gender,
      birthYear: c.birthYear,
      heightCm: c.heightCm,
      education: c.education,
      occupation: c.occupation,
      incomeRange: c.incomeRange,
      residenceCity: c.residenceCity,
      residenceDistrict: c.residenceDistrict,
      introDigest: c.intro ? c.intro.slice(0, 40) : null,
      memberBadge: c.owner.memberLevel === 'PAID' || c.owner.memberLevel === 'TRIAL',
      maritalVerified: c.isMaritalVerified,
      avatarUrl: avatarKey ? await this.storage.signedUrl(avatarKey, 600, blur ? BLUR_PROCESS : undefined) : null,
    };
  }

  private firstPhotoKey(photos: Prisma.JsonValue): string | null {
    if (!Array.isArray(photos)) return null;
    const sorted = [...photos].sort((a, b) => Number((a as { sort?: number }).sort ?? 0) - Number((b as { sort?: number }).sort ?? 0));
    return (sorted[0] as { objectKey?: string })?.objectKey ?? null;
  }
}

function maskNickname(n: string): string {
  if (n.length <= 1) return `${n}**`;
  if (n.length === 2) return `${n[0]}**`;
  return `${n[0]}**${n[n.length - 1]}`;
}
