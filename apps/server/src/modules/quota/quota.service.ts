import { Inject, Injectable, Logger } from '@nestjs/common';
import { MemberQuota, Prisma, QuotaSource, QuotaStatus, QuotaTxReason } from '@prisma/client';
import { ConfigCenter, CONFIG_CENTER } from '../../providers/interfaces';
import { PrismaService } from '../../prisma/prisma.service';

export interface NewbieRewardConfig {
  days: number;
  quota: number;
}

/**
 * 额度账本（D2/D9/D11/D12）。
 * FEFO 扣减在 Step 7 实现；本 Step 提供发放与余额查询。
 * 所有额度变动必须走本 service 并写 QuotaTxLog —— 禁止直接 update member_quota。
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
  ) {}

  async getNewbieReward(): Promise<NewbieRewardConfig> {
    return this.config.get<NewbieRewardConfig>('newbie_reward');
  }

  /** 新用户注册礼：7 天 + 10 额度，frozen，实名通过才解冻（D9，Step 6） */
  async grantNewbieGiftTx(tx: Prisma.TransactionClient, userId: bigint, orderId?: bigint): Promise<MemberQuota> {
    const reward = await this.config.get<NewbieRewardConfig>('newbie_reward');
    const expireAt = new Date(Date.now() + reward.days * 864e5);
    const quota = await tx.memberQuota.create({
      data: {
        userId,
        orderId,
        source: QuotaSource.NEWBIE,
        total: reward.quota,
        remaining: reward.quota,
        status: QuotaStatus.FROZEN,
        expireAt,
      },
    });
    await tx.quotaTxLog.create({
      data: { userId, quotaId: quota.id, reason: QuotaTxReason.GRANT, change: reward.quota, refType: 'newbie_gift' },
    });
    this.logger.log(`user=${userId} 发放新手礼 ${reward.quota} 额度（${reward.days} 天，frozen）`);
    return quota;
  }

  /** 通用发放（Step 6 解冻 / Step 8 会员购买 / Step 15 邀请奖励复用） */
  async grantBatch(
    tx: Prisma.TransactionClient,
    params: { userId: bigint; source: QuotaSource; count: number; days: number; orderId?: bigint; status?: QuotaStatus },
  ): Promise<MemberQuota> {
    const expireAt = new Date(Date.now() + params.days * 864e5);
    const quota = await tx.memberQuota.create({
      data: {
        userId: params.userId,
        orderId: params.orderId,
        source: params.source,
        total: params.count,
        remaining: params.count,
        status: params.status ?? QuotaStatus.ACTIVE,
        expireAt,
      },
    });
    await tx.quotaTxLog.create({
      data: { userId: params.userId, quotaId: quota.id, reason: QuotaTxReason.GRANT, change: params.count, refType: params.source, refId: params.orderId },
    });
    return quota;
  }

  /**
   * 实名通过解冻（D9，§3.1 H 节点）：FROZEN → ACTIVE，额度数量不变。
   * 三唯一命中（同身份证二次注册）时禁止调用 —— 新手礼保持 frozen 直至过期 = 无福利（用例 15）。
   */
  async unfreezeTxFrozen(tx: Prisma.TransactionClient, userId: bigint): Promise<number> {
    const frozen = await tx.memberQuota.findMany({ where: { userId, status: QuotaStatus.FROZEN } });
    for (const batch of frozen) {
      await tx.memberQuota.update({ where: { id: batch.id }, data: { status: QuotaStatus.ACTIVE } });
      await tx.quotaTxLog.create({
        data: { userId, quotaId: batch.id, reason: QuotaTxReason.GRANT, change: 0, refType: 'unfreeze', refId: batch.id },
      });
    }
    if (frozen.length > 0) this.logger.log(`user=${userId} 实名通过，解冻 ${frozen.length} 笔额度批次`);
    return frozen.length;
  }

  /**
   * FEFO 扣 1（PRD §6.1 第 2 步，红线 I2：行锁 + 事务，禁止改实现形状）。
   * 在调用方事务内使用；返回 null = 无可用额度（Step 8 走单次付费分支）。
   * 相对 PRD 原样 SQL 仅追加 expire_at > NOW() 防御（未被定时任务清扫的过期批次不可扣，§6.4）。
   */
  async deductOneTx(tx: Prisma.TransactionClient, userId: bigint): Promise<{ quotaId: string; remainingAfter: number } | null> {
    // 表/列名为 Prisma 默认映射（PascalCase 表名、camelCase 列），语义同 PRD §6.1 原样 SQL
    const rows = await tx.$queryRaw<{ id: bigint; remaining: number }[]>`
      SELECT id, remaining FROM \`MemberQuota\`
      WHERE userId = ${userId} AND status = 'ACTIVE' AND remaining > 0 AND expireAt > NOW()
      ORDER BY expireAt ASC
      LIMIT 1 FOR UPDATE`;
    const row = rows[0];
    if (!row) return null;
    const updated = await tx.memberQuota.update({ where: { id: row.id }, data: { remaining: { decrement: 1 } } });
    await tx.quotaTxLog.create({
      data: { userId, quotaId: row.id, reason: QuotaTxReason.DEDUCT, change: -1, refType: 'unlock' },
    });
    return { quotaId: row.id.toString(), remainingAfter: updated.remaining };
  }

  /** 独立扣减入口（解锁链路 Step 8 在更大事务内复用 deductOneTx） */
  deductOne(userId: bigint) {
    return this.prisma.$transaction((tx) => this.deductOneTx(tx, userId));
  }

  /** 过期清扫（定时任务 + 测试可直调）：ACTIVE 且 expire_at<=now → EXPIRED，流水清零（D2） */
  async expireOverdue(): Promise<number> {
    const due = await this.prisma.memberQuota.findMany({
      where: { status: QuotaStatus.ACTIVE, expireAt: { lte: new Date() } },
    });
    for (const batch of due) {
      await this.prisma.$transaction(async (tx) => {
        await tx.memberQuota.update({ where: { id: batch.id }, data: { status: QuotaStatus.EXPIRED } });
        await tx.quotaTxLog.create({
          data: { userId: batch.userId, quotaId: batch.id, reason: QuotaTxReason.EXPIRE, change: -batch.remaining, refType: 'system' },
        });
      });
    }
    if (due.length > 0) this.logger.log(`额度过期清扫 ${due.length} 笔`);
    return due.length;
  }

  /**
   * 会员时长+额度发放（D10：有效期内顺延 / 过期重新激活；D2：额度到期=会员到期日）。
   * Step 8 支付回调、Step 15 邀请奖励复用。
   */
  async applyMembershipTx(
    tx: Prisma.TransactionClient,
    userId: bigint,
    params: { days: number; quota: number; source: QuotaSource; orderId?: bigint },
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const base = user.memberExpireAt && user.memberExpireAt > now ? user.memberExpireAt : now;
    const expireAt = new Date(base.getTime() + params.days * 864e5);
    await tx.user.update({ where: { id: userId }, data: { memberLevel: 'PAID', memberExpireAt: expireAt } });
    const quota = await tx.memberQuota.create({
      data: { userId, orderId: params.orderId, source: params.source, total: params.quota, remaining: params.quota, status: QuotaStatus.ACTIVE, expireAt },
    });
    await tx.quotaTxLog.create({
      data: { userId, quotaId: quota.id, reason: QuotaTxReason.GRANT, change: params.quota, refType: 'membership', refId: params.orderId },
    });
    return { quota, memberExpireAt: expireAt };
  }

  /**
   * 余额视图（FEFO 排序展示，D11/D12）。
   * frozen（未实名）不计入 totalRemaining（用例 11）；读取时兜底：过期未清扫批次按 EXPIRED 展示。
   */
  async getBalance(userId: bigint) {
    const batches = await this.prisma.memberQuota.findMany({
      where: { userId, status: { in: [QuotaStatus.ACTIVE, QuotaStatus.FROZEN] } },
      orderBy: { expireAt: 'asc' }, // FEFO 顺序即展示顺序
    });
    const now = Date.now();
    // 读取时兜底（§6.4 独立语义）：ACTIVE 但已过 expireAt 的按 EXPIRED 处理，不待定时任务
    const effective = (b: MemberQuota) => (b.status === QuotaStatus.ACTIVE && b.expireAt.getTime() <= now ? QuotaStatus.EXPIRED : b.status);
    const active = batches.filter((b) => effective(b) === QuotaStatus.ACTIVE);
    const frozen = batches.filter((b) => b.status === QuotaStatus.FROZEN);
    const totalRemaining = active.reduce((s, b) => s + b.remaining, 0);
    const frozenTotal = frozen.reduce((s, b) => s + b.remaining, 0);
    const limitTotal = batches.reduce((s, b) => s + b.total, 0);
    return {
      totalRemaining,
      frozenTotal,
      limitLabel: `${totalRemaining + frozenTotal}/${limitTotal}`,
      batches: batches.map((b) => ({
        quotaId: b.id.toString(),
        source: b.source,
        remaining: b.remaining,
        status: effective(b),
        expireAt: b.expireAt.toISOString(),
      })),
    };
  }
}
