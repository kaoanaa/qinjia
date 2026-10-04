import { Inject, Injectable, Logger } from '@nestjs/common';
import { MemberLevel, Prisma, ReferralRewardStatus } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, WECHAT_AUTH, WechatAuth } from '../../providers/interfaces';
import { QuotaService } from '../quota/quota.service';
import { MiscService } from '../misc/misc.service';

interface InviteRewardCfg {
  days: number;
  quota: number;
}

/**
 * 邀请奖励发放（PRD D10/§5.10，用例 12）：被邀请人实名通过事件触发。
 * 邀请人 +N 天会员时长 +M 额度（有效期内顺延 / 过期重新激活），全部数值读 invite_reward 配置（红线 I1）。
 * 三唯一终身一次防刷（§5.10/§6.6）在发奖处二次校验：同设备多开、自邀 → REJECTED 不发奖。
 * （同微信=openid 唯一、同身份证=idCardNoHash 唯一 + Referral.inviteeId 唯一，库层已保证终身仅一次。）
 */
@Injectable()
export class ReferralRewardTrigger {
  private readonly logger = new Logger(ReferralRewardTrigger.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly misc: MiscService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(WECHAT_AUTH) private readonly wechat: WechatAuth,
  ) {}

  async onInviteeRealnamePassed(inviteeId: bigint): Promise<void> {
    const referral = await this.prisma.referral.findUnique({ where: { inviteeId } });
    if (!referral || referral.rewardStatus !== ReferralRewardStatus.PENDING) return;

    const invitee = await this.prisma.user.findUniqueOrThrow({ where: { id: inviteeId } });
    const reject = async (reason: string) => {
      await this.prisma.referral.updateMany({
        where: { id: referral.id, rewardStatus: ReferralRewardStatus.PENDING },
        data: { rewardStatus: ReferralRewardStatus.REJECTED },
      });
      this.logger.warn(`邀请奖励防刷拒绝(${reason})：referral=${referral.id} inviter=${referral.inviterId} invitee=${inviteeId}`);
    };

    // 自邀（同微信闭环）
    if (referral.inviterId === inviteeId) return reject('SELF_INVITE');

    // 同设备指纹多开：该设备指纹下已有“其他被邀请人”拿过奖励 → 终身仅 1 次被邀请奖励
    if (invitee.deviceFingerprint) {
      const sameDeviceIds = await this.prisma.user.findMany({
        where: { deviceFingerprint: invitee.deviceFingerprint, id: { not: inviteeId } },
        select: { id: true },
      });
      const ids = sameDeviceIds.map((u) => u.id);
      if (ids.length > 0) {
        const dup = await this.prisma.referral.findFirst({ where: { inviteeId: { in: ids }, rewardStatus: ReferralRewardStatus.REWARDED } });
        if (dup) return reject('SAME_DEVICE_FINGERPRINT');
      }
    }

    const cfg = await this.config.get<InviteRewardCfg>(ConfigKeys.INVITE_REWARD);
    const inviter = await this.prisma.user.findUniqueOrThrow({ where: { id: referral.inviterId } });
    // D10：有效会员顺延 / 过期重激活；等级只升不降（邀请奖按体验级发，PAID/INTENTION 保持原级）
    const keepLevel = inviter.memberLevel === MemberLevel.PAID || inviter.memberLevel === MemberLevel.INTENTION;
    const level = keepLevel ? inviter.memberLevel : MemberLevel.TRIAL;

    const granted = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const upd = await tx.referral.updateMany({
        where: { id: referral.id, rewardStatus: ReferralRewardStatus.PENDING },
        data: { rewardStatus: ReferralRewardStatus.REWARDED, rewardedAt: new Date() },
      });
      if (upd.count === 0) return false; // 并发重放：仅一次发奖
      await this.quota.applyMembershipTx(tx, referral.inviterId, { days: cfg.days, quota: cfg.quota, source: 'INVITE', level });
      return true;
    });
    if (!granted) return;

    this.logger.log(`邀请奖励到账：inviter=${referral.inviterId} +${cfg.days}天/+${cfg.quota}额度（D10）`);
    // 系统消息 + 订阅消息（模板缺失则跳过旁路，不阻断主流程）
    await this.misc.notifyByTemplate(referral.inviterId, 'reward', 'inviteReward');
    try {
      const imCfg = await this.config.get<{ subscribeTemplates?: Record<string, string> }>(ConfigKeys.IM_CONFIG);
      const tplId = imCfg.subscribeTemplates?.rewardArrived;
      if (tplId) {
        await this.wechat.sendSubscribeMsg(inviter.openid, tplId, { thing1: '邀请奖励已到账', phrase2: String(cfg.quota) }, 'pages/mine/index');
      }
    } catch (e) {
      this.logger.warn(`订阅消息发送失败(旁路)：${(e as Error).message}`);
    }
  }
}
