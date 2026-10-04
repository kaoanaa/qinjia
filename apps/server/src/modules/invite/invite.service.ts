import { Inject, Injectable } from '@nestjs/common';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, STORAGE, StorageProvider } from '../../providers/interfaces';

interface InviteRewardCfg {
  days: number;
  quota: number;
}
interface InviteCopy {
  inviteRuleTip?: string;
  shareCardTitle?: string;
  posterTip?: string;
}

/**
 * 邀请裂变（PRD §5.10/D10，Step 15）：邀请码、奖励规则（数值/话术全读配置，红线 I1）、
 * 邀请记录（被邀请人脱敏，I5）、带参海报数据（小程序码由前端生成，服务端给素材与参数）。
 * 发奖链路在 cert/referral-reward-trigger（实名通过事件）。
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  async info(userId: bigint) {
    const [user, cfg, copy] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.config.get<InviteRewardCfg>(ConfigKeys.INVITE_REWARD),
      this.config.get<InviteCopy>(ConfigKeys.COPYWRITING),
    ]);
    const tip = (copy.inviteRuleTip ?? '')
      .split('{days}').join(String(cfg.days))
      .split('{quota}').join(String(cfg.quota));
    const referrals = await this.prisma.referral.findMany({
      where: { inviterId: userId },
      include: { invitee: { select: { nickname: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      inviteCode: user.inviteCode,
      rewardRule: { ...cfg, tip },
      records: referrals.map((r) => ({
        inviteeMasked: maskNickname(r.invitee.nickname), // I5：不回明文昵称
        rewardStatus: r.rewardStatus,
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
    };
  }

  async poster(userId: bigint) {
    const [user, copy] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.config.get<InviteCopy>(ConfigKeys.COPYWRITING),
    ]);
    // 海报底图：本人生效档案首图，无图走默认占位模板（前端合成小程序码）
    const prof = await this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true } });
    const photos = (prof?.photos as { objectKey: string }[] | null) ?? [];
    const objectKey = photos[0]?.objectKey ?? user.avatarKey ?? 'poster/invite-default.png';
    return {
      posterUrl: await this.storage.signedUrl(objectKey, 600),
      inviteCode: user.inviteCode,
      title: copy.shareCardTitle ?? '',
      tip: copy.posterTip ?? '',
    };
  }
}

function maskNickname(n: string): string {
  if (n.length <= 1) return n;
  if (n.length === 2) return `${n[0]}*`;
  return `${n[0]}**${n[n.length - 1]}`;
}
