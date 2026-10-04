import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { decryptField } from '../../common/crypto';
import { BusinessException } from '../../common/business.exception';
import { NotificationCategory, OpsSlotType, Prisma } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, KV_CACHE, KvCache, SMS, SmsProvider } from '../../providers/interfaces';

interface TicketSlaCfg {
  firstResponseHours: number;
}

const DEFAULT_SWITCHES: Record<string, boolean> = {
  review: true,
  expireRemind: true,
  activity: true,
  rewardArrived: true,
};

/**
 * 消息中心与杂项（PRD §5.12/§5.13，Step 12）：系统消息、工单（SLA 读配置，红线 I1）、
 * 通知开关、运营位（防诈 Banner）。系统消息写入由 cert 解冻/解锁过期等触发方调用 notify()。
 */
@Injectable()
export class MiscService {
  private readonly logger = new Logger(MiscService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(KV_CACHE) private readonly kvCache: KvCache,
    @Inject(SMS) private readonly sms: SmsProvider,
  ) {}

  /** 内部触发口：系统消息落库（话术由调用方从 copywriting.notifyTemplates 读取，禁止硬编码） */
  async notify(userId: bigint, category: NotificationCategory, title: string, body: string) {
    return this.prisma.systemNotification.create({ data: { userId, category, title, body } });
  }

  async notifyByTemplate(userId: bigint, category: NotificationCategory, templateKey: string) {
    const copy = await this.config.get<{ notifyTemplates?: Record<string, { title: string; body: string }> }>(ConfigKeys.COPYWRITING);
    const tpl = copy.notifyTemplates?.[templateKey];
    if (!tpl) return null; // 模板未配置：不阻断主流程（触发方均为旁路）
    return this.notify(userId, category, tpl.title, tpl.body);
  }

  // ==================== 系统消息 ====================

  async listNotifications(userId: bigint, page: number, size: number) {
    const [total, unread, rows] = await Promise.all([
      this.prisma.systemNotification.count({ where: { userId } }),
      this.prisma.systemNotification.count({ where: { userId, readFlag: false } }),
      this.prisma.systemNotification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    return {
      total,
      unread,
      items: rows.map((n) => ({
        id: n.id.toString(),
        category: n.category,
        title: n.title,
        body: n.body,
        readFlag: n.readFlag,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async readAllNotifications(userId: bigint) {
    const { count } = await this.prisma.systemNotification.updateMany({ where: { userId, readFlag: false }, data: { readFlag: true } });
    return { updated: count };
  }

  // ==================== 工单（§5.13，SLA 首响读配置） ====================

  async createTicket(userId: bigint, dto: { type: string; content: string; images?: string[]; orderId?: string }) {
    const sla = await this.config.get<TicketSlaCfg>(ConfigKeys.TICKET_SLA);
    const created = await this.prisma.ticket.create({
      data: {
        userId,
        type: dto.type as never,
        content: dto.content,
        images: (dto.images ?? []) as unknown as Prisma.InputJsonValue,
        slaDeadline: new Date(Date.now() + sla.firstResponseHours * 3600_000), // 禁止代码写死 48（I1）
      },
    });
    return this.serializeTicket(created);
  }

  async listMyTickets(userId: bigint) {
    const rows = await this.prisma.ticket.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map((t) => this.serializeTicket(t));
  }

  private serializeTicket(t: { id: bigint; type: string; content: string; status: string; slaDeadline: Date; handlerNote: string | null; createdAt: Date }) {
    return {
      id: t.id.toString(),
      type: t.type,
      content: t.content,
      status: t.status,
      slaDeadline: t.slaDeadline.toISOString(),
      handlerNote: t.handlerNote,
      createdAt: t.createdAt.toISOString(),
    };
  }

  // ==================== 通知设置（我的页开关） ====================

  async getNotifySettings(userId: bigint) {
    const pref = await this.prisma.notifyPref.findUnique({ where: { userId } });
    return {
      switches: { ...DEFAULT_SWITCHES, ...((pref?.switches as Record<string, boolean>) ?? {}) },
      subscribeAuthStatus: pref?.subscribeAuthStatus ?? 'UNKNOWN',
    };
  }

  async updateNotifySettings(userId: bigint, dto: { switches?: Record<string, boolean>; subscribeAuthStatus?: string }) {
    this.assertSwitchValues(dto.switches);
    const existing = await this.prisma.notifyPref.findUnique({ where: { userId } });
    const switches = { ...DEFAULT_SWITCHES, ...((existing?.switches as Record<string, boolean>) ?? {}), ...(dto.switches ?? {}) };
    const subscribeAuthStatus = dto.subscribeAuthStatus ?? existing?.subscribeAuthStatus ?? 'UNKNOWN';
    const pref = await this.prisma.notifyPref.upsert({
      where: { userId },
      create: { userId, switches: switches as object, subscribeAuthStatus: subscribeAuthStatus as never },
      update: { switches: switches as object, subscribeAuthStatus: subscribeAuthStatus as never },
    });
    return { switches, subscribeAuthStatus: pref.subscribeAuthStatus };
  }

  private assertSwitchValues(switches?: Record<string, boolean>) {
    if (switches && Object.values(switches).some((v) => typeof v !== 'boolean')) {
      throw new BadRequestException('switches 的值必须是布尔');
    }
  }

  // ==================== 运营位（防诈 Banner / 倒计时条数据源） ====================

  async listOpsSlots(type?: string) {
    const now = new Date();
    const rows = await this.prisma.opsSlot.findMany({
      where: {
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
        ...(type ? { type: type as OpsSlotType } : {}),
      },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id.toString(),
      type: s.type,
      content: s.content,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      sort: s.sort,
      enabled: s.enabled,
    }));
  }

  // ==================== 黑名单（§6.2 推荐硬过滤互斥，Step 16） ====================

  async listBlacklist(userId: bigint) {
    const rows = await this.prisma.blacklist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { nickname: true } } },
    });
    return {
      items: rows.map((b) => ({
        id: b.id.toString(),
        blockedUserId: b.blockedUserId.toString(),
        nicknameMasked: maskNickname(b.blocked.nickname), // I5
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }

  async addBlacklist(userId: bigint, blockedUserId: bigint) {
    if (userId === blockedUserId) throw new BadRequestException('不能拉黑自己');
    const target = await this.prisma.user.findUnique({ where: { id: blockedUserId }, select: { id: true } });
    if (!target) throw new BadRequestException('目标用户不存在');
    await this.prisma.blacklist.upsert({
      where: { userId_blockedUserId: { userId, blockedUserId } },
      create: { userId, blockedUserId },
      update: {},
    });
    // 拉黑即时生效：清掉本人当日 feed 排序缓存（红线 I3 同款「服务端说了算」思路）
    const my = await this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true }, select: { id: true } });
    if (my) {
      const n = new Date();
      await this.kvCache.del(`feed:${my.id}:${new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10)}`);
    }
    return { blocked: true };
  }

  // ==================== 设置全集（§5.8，Step 16） ====================

  /** 隐私开关：仅同城可见 / 子女协助管理（大额支付通知子女，阈值读 big_pay_threshold，I1） */
  async updatePrivacy(userId: bigint, dto: { cityOnlyVisible?: boolean; bigPayNotifyChild?: boolean }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.cityOnlyVisible != null ? { cityOnlyVisible: dto.cityOnlyVisible } : {}), ...(dto.bigPayNotifyChild != null ? { bigPayNotifyChild: dto.bigPayNotifyChild } : {}) },
    });
    return { id: user.id.toString(), nickname: user.nickname, cityOnlyVisible: user.cityOnlyVisible, bigPayNotifyChild: user.bigPayNotifyChild };
  }

  /** 实名信息回显（I5：仅掩码，不回哈希/明文） */
  async getRealnameInfo(userId: bigint) {
    const cert = await this.prisma.certification.findFirst({ where: { userId, type: 'ID_CARD_OCR', result: 'PASSED' }, orderBy: { createdAt: 'desc' } });
    const detail = (cert?.detail ?? {}) as { idCardNoMasked?: string; name?: string };
    return {
      realnamePassed: !!cert,
      idCardNoMasked: detail.idCardNoMasked ?? null,
      nameMasked: detail.name ? maskNickname(detail.name) : null,
      certifiedAt: cert?.createdAt.toISOString() ?? null,
    };
  }

  /** 子女授权管理：本账号各档案的 consent_record（手机号掩码，I5） */
  async listConsents(userId: bigint) {
    const profiles = await this.prisma.profile.findMany({ where: { ownerUserId: userId }, select: { id: true, matchNo: true, relation: true, isActive: true } });
    const records = await this.prisma.consentRecord.findMany({ where: { profileId: { in: profiles.map((p) => p.id) } }, orderBy: { createdAt: 'desc' } });
    return {
      items: records.map((r) => {
        const p = profiles.find((x) => x.id === r.profileId);
        let masked = '****';
        try {
          const phone = decryptField(r.childPhone);
          masked = `${phone.slice(0, 3)}****${phone.slice(-4)}`; // 仅展示头尾（I5）
        } catch {
          /* 密文损坏兜底 */
        }
        return {
          consentId: r.id.toString(),
          profileId: r.profileId.toString(),
          matchNo: p?.matchNo ?? null,
          relation: p?.relation ?? null,
          childPhoneMasked: masked,
          statementVersion: r.statementVersion,
          activeProfile: !!p?.isActive,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  }

  /**
   * 撤回子女授权（PIPL：撤回同意→停止处理）：删除留痕记录并将对应档案下架，
   * 重新发布需再次授权（§5.2/§5.8）。
   */
  async revokeConsent(userId: bigint, consentId: bigint) {
    const record = await this.prisma.consentRecord.findUnique({ where: { id: consentId }, include: { profile: { select: { id: true, ownerUserId: true } } } });
    if (!record || record.profile.ownerUserId !== userId) throw new NotFoundException('授权记录不存在');
    await this.prisma.$transaction([
      this.prisma.consentRecord.delete({ where: { id: consentId } }),
      this.prisma.profile.update({ where: { id: record.profileId }, data: { isActive: false, rejectReason: '子女授权已撤回，档案下架；如需重新发布请再次授权' } }),
    ]);
    return { revoked: true };
  }

  // ==================== 注销账号（§5.8/PIPL 红线 5，Step 16） ====================

  /** 受理注销：二次确认 + 短信验证码 + 冷静期（天数读 account_close 配置，I1）；档案即时下架 */
  async closeAccount(userId: bigint, dto: { confirmed?: boolean; smsCode?: string }) {
    if (!dto.confirmed) throw new BusinessException(400, 'CLOSE_CONFIRM_REQUIRED', '请先阅读并确认注销风险提示');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE') throw new BusinessException(400, 'ACCOUNT_STATE_INVALID', '账号状态不允许注销');
    if (!user.phone) throw new BusinessException(400, 'PHONE_REQUIRED', '注销需短信验证，请先绑定手机号');
    const ok = await this.sms.verifyCode(user.phone, 'close_account', dto.smsCode ?? '');
    if (!ok) throw new BusinessException(400, 'SMS_CODE_INVALID', '短信验证码错误');
    if (user.closeScheduledAt) return { effectiveAt: user.closeScheduledAt.toISOString(), alreadyScheduled: true }; // 重复提交幂等

    const cfg = await this.config.get<{ coolingOffDays: number }>(ConfigKeys.ACCOUNT_CLOSE);
    const effectiveAt = new Date(Date.now() + cfg.coolingOffDays * 864e5);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { closeScheduledAt: effectiveAt } }),
      this.prisma.profile.updateMany({ where: { ownerUserId: userId, isActive: true }, data: { isActive: false } }), // 即时停止对外处理（PIPL 撤回同意）
    ]);
    return { effectiveAt: effectiveAt.toISOString() };
  }

  /**
   * 冷静期到期匿名化（Job 调用，测试可直调）：
   * 子女/个人敏感数据物理删除（档案/照片引用/授权留痕/实名件/工单/会话/行为记录），
   * 账号骨架匿名化（openid/昵称/手机号/身份证哈希/设备指纹清空）；
   * 资金与风控留痕按《会计法》《电商法》最短必要保留（PIPL §47 法定豁免），用户行已不可识别。
   */
  async anonymizeDue(): Promise<number> {
    const due = await this.prisma.user.findMany({ where: { status: 'ACTIVE', closeScheduledAt: { not: null, lte: new Date() } }, select: { id: true } });
    for (const { id: userId } of due) {
      await this.prisma.$transaction(async (tx) => {
        const profiles = await tx.profile.findMany({ where: { ownerUserId: userId }, select: { id: true } });
        const pids = profiles.map((p) => p.id);
        const convs = await tx.conversation.findMany({
          where: { OR: [{ userA: userId }, { userB: userId }, ...(pids.length ? [{ profileA: { in: pids } }, { profileB: { in: pids } }] : [])] },
          select: { id: true },
        });
        const cids = convs.map((c) => c.id);
        if (cids.length) {
          await tx.message.deleteMany({ where: { convId: { in: cids } } });
          await tx.contactActionLog.deleteMany({ where: { convId: { in: cids } } });
        }
        if (pids.length) {
          await tx.consentRecord.deleteMany({ where: { profileId: { in: pids } } });
          await tx.feedRotationCard.deleteMany({ where: { profileId: { in: pids } } });
          await tx.viewRecord.deleteMany({ where: { OR: [{ fromUserId: userId }, { toProfileId: { in: pids } }] } });
          await tx.favoriteRecord.deleteMany({ where: { OR: [{ fromUserId: userId }, { toProfileId: { in: pids } }] } });
          await tx.unlockRecord.deleteMany({ where: { OR: [{ initiatorUserId: userId }, { targetProfileId: { in: pids } }] } });
        }
        await tx.conversation.deleteMany({ where: { id: { in: cids } } });
        await tx.ticket.deleteMany({ where: { userId } });
        await tx.managerLead.deleteMany({ where: { userId } });
        await tx.notifyPref.deleteMany({ where: { userId } });
        await tx.systemNotification.deleteMany({ where: { userId } });
        await tx.blacklist.deleteMany({ where: { OR: [{ userId }, { blockedUserId: userId }] } });
        await tx.certification.deleteMany({ where: { userId } });
        await tx.profile.deleteMany({ where: { ownerUserId: userId } });
        await tx.user.update({
          where: { id: userId },
          data: {
            status: 'CLOSED',
            openid: `closed_${randomUUID()}`, // 骨架匿名化：原微信身份不可再关联
            unionid: null,
            phone: null,
            nickname: '已注销用户',
            avatarKey: null,
            idCardNoHash: null,
            deviceFingerprint: null,
            memberLevel: 'NONE',
            memberExpireAt: null,
            cityOnlyVisible: false,
            bigPayNotifyChild: false,
          },
        });
        await tx.adminAuditLog.create({
          data: { adminUserId: 0n, action: 'account_close_anonymize', targetType: 'user', targetId: userId.toString(), after: { closedAt: new Date().toISOString() } },
        });
      });
    }
    if (due.length) this.logger.log(`注销匿名化 ${due.length} 个账号`);
    return due.length;
  }

  // ==================== 加速脱单管家留资（§5.12/D6，Step 17） ====================

  /** 一人一条（schema @@unique([userId])）：已有记录则更新诉求，重复提交幂等 */
  async createManagerLead(userId: bigint, dto: { city: string; expectation: string; budgetCent?: number }) {
    const done = await this.prisma.managerLead.findUnique({ where: { userId } });
    if (done?.status === 'DONE') throw new BusinessException(400, 'LEAD_DONE', '您已有完成的管家服务，如需再次服务请联系客服');
    const lead = done
      ? await this.prisma.managerLead.update({
          where: { userId },
          data: { city: dto.city, expectation: dto.expectation, budgetCent: dto.budgetCent ?? null },
        })
      : await this.prisma.managerLead.create({
          data: { userId, city: dto.city, expectation: dto.expectation, budgetCent: dto.budgetCent ?? null },
        });
    return { leadId: lead.id.toString(), status: lead.status };
  }

  // ==================== P2 占位（D8/Step 18） ====================

  /** 直播浮窗/本地群：不建表不开发，仅"敬请期待"话术（读 copywriting 配置，红线 I1） */
  async p2Placeholder(copyKey: 'livePlaceholder' | 'groupPlaceholder') {
    const copy = await this.config.get<Record<string, string | undefined>>(ConfigKeys.COPYWRITING);
    return { available: false, tip: copy[copyKey] ?? null };
  }
}

function maskNickname(n: string): string {
  if (n.length <= 1) return `${n}**`;
  if (n.length === 2) return `${n[0]}**`;
  return `${n[0]}**${n[n.length - 1]}`;
}
