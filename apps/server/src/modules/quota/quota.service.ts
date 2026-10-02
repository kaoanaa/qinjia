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
   * 余额视图（FEFO 排序展示，D11/D12）。
   * frozen（未实名）不计入 totalRemaining（用例 11）。
   */
  async getBalance(userId: bigint) {
    const batches = await this.prisma.memberQuota.findMany({
      where: { userId, status: { in: [QuotaStatus.ACTIVE, QuotaStatus.FROZEN] } },
      orderBy: { expireAt: 'asc' }, // FEFO 顺序即展示顺序
    });
    const active = batches.filter((b) => b.status === QuotaStatus.ACTIVE);
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
        status: b.status,
        expireAt: b.expireAt.toISOString(),
      })),
    };
  }
}
