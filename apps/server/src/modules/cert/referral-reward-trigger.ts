import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 邀请奖励触发点（用例 12 前半段）。
 * Step 15 在此实现：invite_reward 配置读取 + 邀请人会员顺延/重激活（D10）+ 额度批次 + 系统消息 + 防刷拒绝。
 */
@Injectable()
export class ReferralRewardTrigger {
  private readonly logger = new Logger(ReferralRewardTrigger.name);

  constructor(private readonly prisma: PrismaService) {}

  async onInviteeRealnamePassed(inviteeId: bigint): Promise<void> {
    const referral = await this.prisma.referral.findUnique({ where: { inviteeId } });
    if (referral && referral.rewardStatus === 'PENDING') {
      this.logger.log(`触发邀请奖励待发奖（Step 15 发放）：referral=${referral.id} inviter=${referral.inviterId} invitee=${inviteeId}`);
    }
  }
}
