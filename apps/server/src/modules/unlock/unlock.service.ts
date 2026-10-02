import {
  BadRequestException,
  ConflictException,
  forwardRef,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Conversation, Prisma, UnlockPayType, UnlockRecord, UnlockStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, ImProvider, IM } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { ProfileService } from '../profile/profile.service';
import { QuotaService } from '../quota/quota.service';
import { OrderService, PrepayOrderView } from '../order/order.service';

type UnlockTarget = Awaited<ReturnType<ProfileService['getUnlockTarget']>>;

export interface UnlockResultView {
  unlockId: string;
  payType: UnlockPayType;
  quotaRemainAfter: number | null;
  expireAt: string;
  conversation: Awaited<ReturnType<UnlockService['conversationView']>>;
  contact: { wechat: string | null; phone: string | null };
}

export type UnlockOutcome =
  | { kind: 'unlocked'; result: UnlockResultView }
  | { kind: 'need_payment'; order: PrepayOrderView };

const EDUCATION_LABEL: Record<string, string> = {
  JUNIOR_HIGH: '初中',
  HIGH_SCHOOL: '高中',
  VOCATIONAL: '职高',
  COLLEGE: '大专',
  BACHELOR: '本科',
  MASTER: '研究生',
  DOCTOR: '博士',
};

/**
 * 解锁状态机（PRD §6.1，D3/D12，红线 I2）。
 * 三步校验顺序：①已有 active 关系复用 → ②FEFO 行锁扣 1 → ③单次付费/券（支付回调后写记录）。
 * 被动方双向生效、不扣额度；expire_at 恒 created+30d（读 unlock_validity 配置）。
 */
@Injectable()
export class UnlockService {
  private readonly logger = new Logger(UnlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
    private readonly quota: QuotaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(IM) private readonly im: ImProvider,
    @Inject(forwardRef(() => OrderService)) private readonly order: OrderService,
  ) {}

  async check(userId: bigint, profileId: bigint): Promise<{
    state: 'already_unlocked' | 'quota_available' | 'need_payment' | 'realname_required';
    targetMaritalVerified: boolean;
    riskConfirmRequired: boolean;
    oncePriceCent: number;
    expireAt: string | null;
  }> {
    const target = await this.mustTarget(userId, profileId);
    const oncePriceCent = await this.oncePriceCent();
    const risk = { targetMaritalVerified: target.isMaritalVerified, riskConfirmRequired: !target.isMaritalVerified, oncePriceCent };

    const existing = await this.findActiveUnlock(userId, target.id);
    if (existing) return { state: 'already_unlocked', ...risk, expireAt: existing.expireAt.toISOString() };

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { idCardNoHash: true } });
    if (!user.idCardNoHash) return { state: 'realname_required', ...risk, expireAt: null }; // 用例 11

    const balance = await this.quota.getBalance(userId);
    const state = balance.totalRemaining > 0 ? 'quota_available' : 'need_payment';
    return { state, ...risk, expireAt: null };
  }

  /**
   * 执行解锁（§6.1 三步顺序）。riskConfirmed 校验先于一切扣费（用例 13：确认后才扣费）。
   * 未实名 402；未核验且未确认 412；有 active 关系直接放行（用例 6）；额度分支行锁事务；否则走订单预支付。
   */
  async unlock(userId: bigint, dto: { profileId: bigint; riskConfirmed: boolean; userCouponId?: bigint }): Promise<UnlockOutcome> {
    const target = await this.mustTarget(userId, dto.profileId);

    // ① 已有 active 关系 → 放行不扣费（用例 6）
    const existing = await this.findActiveUnlock(userId, target.id);
    if (existing) return { kind: 'unlocked', result: await this.buildResult(existing, userId, 'REUSE') };

    // 未核验档案：必须显式风险确认（§6.3 用例 13，话术读 copywriting，红线 I1）
    if (!target.isMaritalVerified && !dto.riskConfirmed) {
      const copy = await this.config.get<{ unverifiedUnlockConfirm: string }>(ConfigKeys.COPYWRITING);
      throw new BusinessException(HttpStatus.PRECONDITION_FAILED, 'RISK_CONFIRM_REQUIRED', copy.unverifiedUnlockConfirm);
    }

    // 未实名 → 402 引导话术（用例 11：frozen 不可扣，服务端拦截）
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { idCardNoHash: true } });
    if (!user.idCardNoHash) {
      const copy = await this.config.get<{ unlockBtnRealnameGuide: string }>(ConfigKeys.COPYWRITING);
      throw new BusinessException(HttpStatus.PAYMENT_REQUIRED, 'REALNAME_REQUIRED', copy.unlockBtnRealnameGuide);
    }

    // ② FEFO 扣 1（行锁事务内写 unlock_record + 开会话；并发竞态由唯一约束兜底）
    const days = await this.unlockDays();
    const deducted = await this.prisma.$transaction(async (tx) => {
      const ded = await this.quota.deductOneTx(tx, userId);
      if (!ded) return null;
      const rec = await this.createUnlockTx(tx, {
        userId,
        target,
        payType: UnlockPayType.QUOTA,
        days,
        quotaId: BigInt(ded.quotaId),
        riskConfirmed: dto.riskConfirmed,
      });
      return { rec, remainingAfter: ded.remainingAfter };
    }).catch(async (e) => {
      // 并发重复解锁：唯一约束冲突 → 回滚扣减，读取对手已写入的 active 关系
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.findActiveUnlock(userId, target.id);
        if (raced) return { raced };
      }
      throw e;
    });

    if (deducted && 'rec' in deducted) {
      return { kind: 'unlocked', result: await this.buildResult(deducted.rec, userId, deducted.remainingAfter) };
    }
    if (deducted && 'raced' in deducted) {
      return { kind: 'unlocked', result: await this.buildResult(deducted.raced, userId, 'REUSE') };
    }

    // ③ 单次付费 / 券抵扣（¥19.9 读配置；券全额抵扣时订单服务内部直接完成解锁）
    const orderResult = await this.order.createUnlockOrder(userId, target.id, dto.userCouponId, dto.riskConfirmed);
    if (orderResult.immediate) {
      const rec = await this.prisma.unlockRecord.findUniqueOrThrow({ where: { id: orderResult.unlockId! } });
      return { kind: 'unlocked', result: await this.buildResult(rec, userId, null) };
    }
    return { kind: 'need_payment', order: orderResult.prepay! };
  }

  /** 支付回调/0 元券完成后写解锁（幂等：调用方已用 payStatus 门闸保证仅执行一次） */
  async createUnlockTx(
    tx: Prisma.TransactionClient,
    params: {
      userId: bigint;
      target: UnlockTarget;
      payType: UnlockPayType;
      days: number;
      quotaId?: bigint;
      orderId?: bigint;
      userCouponId?: bigint;
      riskConfirmed: boolean;
    },
  ): Promise<UnlockRecord> {
    const expireAt = new Date(Date.now() + params.days * 864e5);
    const rec = await tx.unlockRecord.create({
      data: {
        initiatorUserId: params.userId,
        targetProfileId: params.target.id,
        payType: params.payType,
        quotaId: params.quotaId,
        orderId: params.orderId,
        userCouponId: params.userCouponId,
        status: UnlockStatus.ACTIVE,
        expireAt,
        riskConfirmed: params.riskConfirmed,
      },
    });
    await this.openConversationTx(tx, params.userId, params.target, rec.id);
    return rec;
  }

  /** 会话开通（幂等）：(userA,userB) 规范化排序，已存在则复用 */
  private async openConversationTx(tx: Prisma.TransactionClient, initiatorUserId: bigint, target: UnlockTarget, unlockRecordId: bigint) {
    const initProfile = await this.profile.getActiveProfileRaw(initiatorUserId);
    if (!initProfile) throw new BadRequestException('请先创建并生效你的档案');
    const [userA, userB] = initiatorUserId < target.ownerUserId ? [initiatorUserId, target.ownerUserId] : [target.ownerUserId, initiatorUserId];
    const [profileA, profileB] =
      initiatorUserId < target.ownerUserId ? [initProfile.id, target.id] : [target.id, initProfile.id];
    const existing = await tx.conversation.findUnique({ where: { userA_userB: { userA, userB } } });
    if (existing) return existing;
    const conv = await tx.conversation.create({
      data: { userA, userB, profileA, profileB, unlockRecordId, imConvId: `mock_conv_${randomUUID()}` },
    });
    // §3.4 解锁成功→IM 双向开放（SS 模式下 TIER 权限最终由服务端回调裁决，addFriend 失败不阻断解锁）
    void this.im.addFriend(String(userA), String(userB)).catch((e: Error) => this.logger.warn(`IM addFriend 失败: ${e.message}`));
    return conv;
  }

  /** 两用户间当前生效的解锁（任意方向；被动方双向可聊 D12） */
  async activeUnlockBetween(userA: bigint, userB: bigint): Promise<UnlockRecord | null> {
    const pairWhere = await this.pairUnlockWhere(userA, userB);
    if (!pairWhere) return null;
    return this.prisma.unlockRecord.findFirst({
      where: { ...pairWhere, status: UnlockStatus.ACTIVE, expireAt: { gt: new Date() } },
      orderBy: { expireAt: 'desc' },
    });
  }

  /** 会话列表/接触升级用：当前生效解锁 + 最近一次过期时间（区分"未解锁/已过期"话术） */
  async unlockStateBetween(userA: bigint, userB: bigint): Promise<{ active: UnlockRecord | null; lastExpireAt: Date | null }> {
    const pairWhere = await this.pairUnlockWhere(userA, userB);
    if (!pairWhere) return { active: null, lastExpireAt: null };
    const [active, last] = await Promise.all([
      this.prisma.unlockRecord.findFirst({ where: { ...pairWhere, status: UnlockStatus.ACTIVE, expireAt: { gt: new Date() } }, orderBy: { expireAt: 'desc' } }),
      this.prisma.unlockRecord.findFirst({ where: pairWhere, orderBy: { expireAt: 'desc' }, select: { expireAt: true } }),
    ]);
    return { active, lastExpireAt: last?.expireAt ?? null };
  }

  /** 解锁方向：target 档案属主是 A → 发起方必为 B（反之亦然） */
  private async pairUnlockWhere(userA: bigint, userB: bigint) {
    const owned = await this.prisma.profile.findMany({ where: { ownerUserId: { in: [userA, userB] } }, select: { id: true, ownerUserId: true } });
    if (owned.length < 2) return null;
    return {
      OR: owned.map((p) => ({
        initiatorUserId: p.ownerUserId === userA ? userB : userA,
        targetProfileId: p.id,
      })),
    };
  }

  async conversationView(conv: Conversation, viewerUserId: bigint, unlockExpireAt: Date) {
    const isViewerA = conv.userA === viewerUserId;
    const counterpartUserId = isViewerA ? conv.userB : conv.userA;
    const counterpartProfileId = isViewerA ? conv.profileB : conv.profileA;
    const [cpUser, cpProfile] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: counterpartUserId },
        select: { nickname: true, memberLevel: true, memberExpireAt: true },
      }),
      this.prisma.profile.findUniqueOrThrow({ where: { id: counterpartProfileId } }),
    ]);
    return {
      id: conv.id.toString(),
      imConvId: conv.imConvId ?? '',
      counterpart: {
        nickname: cpUser.nickname,
        relation: cpProfile.relation,
        memberBadge: cpUser.memberLevel === 'PAID' || cpUser.memberLevel === 'TRIAL',
        matchNo: cpProfile.matchNo,
        childDigest: `${cpProfile.gender === 'FEMALE' ? '女' : '男'}·${String(cpProfile.birthYear).slice(2)}年·${cpProfile.residenceCity}·${cpProfile.heightCm}cm·${EDUCATION_LABEL[cpProfile.education] ?? ''}·${cpProfile.occupation}`,
      },
      lastMsgAt: conv.lastMsgAt?.toISOString() ?? null,
      lastMsgDigest: conv.lastMsgDigest,
      unlockExpireAt: unlockExpireAt.toISOString(),
      canSend: unlockExpireAt.getTime() > Date.now(), // 过期禁发（D3；IM 回调同规则，Step 10）
    };
  }

  /** UnlockResult（openapi）：联系方式服务端裁决下发（红线 I3） */
  async buildResult(rec: UnlockRecord, viewerUserId: bigint, quotaRemainAfter: number | 'REUSE' | null): Promise<UnlockResultView> {
    const [target, conv] = await Promise.all([
      this.profile.getUnlockTarget(rec.targetProfileId),
      this.findConversation(rec),
    ]);
    return {
      unlockId: rec.id.toString(),
      payType: rec.payType,
      quotaRemainAfter: quotaRemainAfter === 'REUSE' ? null : quotaRemainAfter,
      expireAt: rec.expireAt.toISOString(),
      conversation: await this.conversationView(conv, viewerUserId, rec.expireAt),
      contact: { wechat: null, phone: target.owner.phone }, // 交换微信动作在 Step 10/11 留痕后才返回
    };
  }

  private async findConversation(rec: UnlockRecord) {
    const byRec = await this.prisma.conversation.findFirst({ where: { unlockRecordId: rec.id } });
    if (byRec) return byRec;
    const target = await this.prisma.profile.findUniqueOrThrow({ where: { id: rec.targetProfileId }, select: { ownerUserId: true } });
    const [userA, userB] = rec.initiatorUserId < target.ownerUserId ? [rec.initiatorUserId, target.ownerUserId] : [target.ownerUserId, rec.initiatorUserId];
    return this.prisma.conversation.findUniqueOrThrow({ where: { userA_userB: { userA, userB } } });
  }

  /** 解锁记录（P1 记录页/Step 12 复用）：主动发起 + 被动获得（FREE_GRANT 展示） */
  async listRecords(userId: bigint, page: number, size: number) {
    const [initiated, granted] = await Promise.all([
      this.prisma.unlockRecord.findMany({
        where: { initiatorUserId: userId },
        include: { target: { include: { owner: { select: { nickname: true } } } } },
      }),
      this.prisma.unlockRecord.findMany({
        where: { target: { ownerUserId: userId } },
        include: { target: { select: { matchNo: true } }, initiator: { select: { nickname: true } } },
      }),
    ]);
    const items = [
      ...initiated.map((r) => ({
        id: r.id.toString(),
        direction: 'initiated_by_me' as const,
        targetProfile: `${r.target.matchNo}·${r.target.owner.nickname}`,
        payType: r.payType,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        expireAt: r.expireAt.toISOString(),
      })),
      ...granted.map((r) => ({
        id: r.id.toString(),
        direction: 'granted_to_me' as const,
        targetProfile: `${r.target.matchNo}·${r.initiator.nickname}`,
        payType: 'FREE_GRANT' as const, // 被动方不扣额度不扣费（用例 2）
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        expireAt: r.expireAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { total: items.length, items: items.slice((page - 1) * size, page * size) };
  }

  /** 过期清扫（定时任务 + 测试直调，用例 3）；会话历史保留，仅状态迁移 + IM 关权限（ARCHITECTURE 定时任务表） */
  async expireOverdue(): Promise<number> {
    const due = await this.prisma.unlockRecord.findMany({ where: { status: UnlockStatus.ACTIVE, expireAt: { lte: new Date() } } });
    for (const rec of due) {
      await this.prisma.unlockRecord.update({ where: { id: rec.id }, data: { status: UnlockStatus.EXPIRED } });
      const owner = await this.prisma.profile.findUniqueOrThrow({ where: { id: rec.targetProfileId }, select: { ownerUserId: true } });
      const [a, b] = rec.initiatorUserId < owner.ownerUserId ? [rec.initiatorUserId, owner.ownerUserId] : [owner.ownerUserId, rec.initiatorUserId];
      void this.im.forbidSend(String(a), String(b)).catch((e: Error) => this.logger.warn(`IM forbidSend 失败: ${e.message}`));
    }
    if (due.length > 0) this.logger.log(`解锁过期清扫 ${due.length} 笔`);
    return due.length;
  }

  /** Refunded 分支（§6.1）：额度解锁返还 remaining+1 并写流水；付费/券订单退款走 Step 17 原路退回 */
  async refundQuotaUnlock(unlockId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.unlockRecord.findUniqueOrThrow({ where: { id: unlockId } });
      if (rec.status !== UnlockStatus.ACTIVE) throw new ConflictException('仅 active 解锁可退款');
      await tx.unlockRecord.update({ where: { id: rec.id }, data: { status: UnlockStatus.REFUNDED } });
      if (rec.payType === UnlockPayType.QUOTA && rec.quotaId) {
        await tx.memberQuota.update({ where: { id: rec.quotaId }, data: { remaining: { increment: 1 } } });
        await tx.quotaTxLog.create({
          data: { userId: rec.initiatorUserId, quotaId: rec.quotaId, reason: 'REFUND', change: 1, refType: 'unlock', refId: rec.id },
        });
      }
      return { unlockId: rec.id.toString(), refundedQuota: rec.payType === UnlockPayType.QUOTA && !!rec.quotaId };
    });
  }

  // ==================== 私有 ====================

  private async mustTarget(userId: bigint, profileId: bigint): Promise<UnlockTarget> {
    const target = await this.profile.getUnlockTarget(profileId);
    if (target.ownerUserId === userId) throw new BadRequestException('不能解锁自己的档案');
    if (target.auditStatus !== 'APPROVED' || !target.publishedAt) throw new NotFoundException('档案未上线');
    return target;
  }

  private async findActiveUnlock(userId: bigint, targetProfileId: bigint) {
    return this.prisma.unlockRecord.findFirst({
      where: { initiatorUserId: userId, targetProfileId, status: UnlockStatus.ACTIVE, expireAt: { gt: new Date() } },
    });
  }

  private async oncePriceCent(): Promise<number> {
    const c = await this.config.get<{ amountCent: number }>(ConfigKeys.UNLOCK_ONCE_PRICE);
    return c.amountCent;
  }

  private async unlockDays(): Promise<number> {
    const c = await this.config.get<{ days: number }>(ConfigKeys.UNLOCK_VALIDITY);
    if (!c?.days) throw new Error('缺少 unlock_validity 配置（红线 I1：禁止代码内兜底数值）');
    return c.days;
  }
}
