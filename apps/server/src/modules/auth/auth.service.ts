import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, ReferralRewardStatus, User } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WechatAuth, WECHAT_AUTH } from '../../providers/interfaces';
import { QuotaService } from '../quota/quota.service';

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去易混淆字符

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WECHAT_AUTH) private readonly wechat: WechatAuth,
    private readonly quota: QuotaService,
    private readonly jwt: JwtService,
  ) {}

  /** 主链路 §3.1 A→B：登录，新用户自动注册并发 frozen 新手礼（D9） */
  async login(dto: { code: string; deviceFingerprint?: string; inviteCode?: string }) {
    const { openid, unionid } = await this.wechat.code2session(dto.code);

    const existing = await this.prisma.user.findUnique({ where: { openid } });
    if (existing) {
      if (dto.deviceFingerprint && existing.deviceFingerprint !== dto.deviceFingerprint) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { deviceFingerprint: dto.deviceFingerprint },
        });
      }
      return { token: await this.sign(existing), isNewUser: false, user: await this.toView(existing) };
    }

    // 解析邀请关系（仅登记，发奖在实名通过时，D10/用例 12）
    let inviterId: bigint | undefined;
    if (dto.inviteCode) {
      const inviter = await this.prisma.user.findUnique({ where: { inviteCode: dto.inviteCode } });
      if (inviter) inviterId = inviter.id;
      else this.logger.warn(`无效邀请码: ${dto.inviteCode}`);
    }

    const newbie = await this.quota.getNewbieReward();
    const inviteCode = await this.genInviteCode();
    const memberExpireAt = new Date(Date.now() + newbie.days * 864e5);

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            openid,
            unionid,
            nickname: `亲家${randomInt(1000, 10000)}`,
            inviteCode,
            invitedByUserId: inviterId,
            deviceFingerprint: dto.deviceFingerprint,
            memberLevel: 'TRIAL',
            memberExpireAt,
            newbieRewardClaimed: true,
          },
        });
        // 注册即发 7 天体验会员 + 10 额度（frozen，实名后解冻 D9）
        await this.quota.grantNewbieGiftTx(tx, created.id);
        if (inviterId) {
          await tx.referral.create({
            data: { inviterId, inviteeId: created.id, rewardStatus: ReferralRewardStatus.PENDING },
          });
        }
        return created;
      });
    } catch (e) {
      // openid 并发竞态：另一个请求已建号发奖，走已存在分支
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.user.findUnique({ where: { openid } });
        if (raced) return { token: await this.sign(raced), isNewUser: false, user: await this.toView(raced) };
      }
      throw e;
    }

    this.logger.log(`新用户注册 id=${user.id} openid=${openid}`);
    return { token: await this.sign(user), isNewUser: true, user: await this.toView(user) };
  }

  /** 手机号快速验证绑定；同号已被占用 → 400（三唯一前置约束） */
  async bindPhone(userId: bigint, phoneCode: string) {
    const { phoneNumber } = await this.wechat.getPhoneNumber(phoneCode);
    const taken = await this.prisma.user.findUnique({ where: { phone: phoneNumber } });
    if (taken && taken.id !== userId) {
      throw new BadRequestException('该手机号已绑定其他账号，请先解绑或联系客服');
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { phone: phoneNumber } });
    return this.toView(user);
  }

  async me(userId: bigint) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const quotaBalance = await this.quota.getBalance(userId);
    return { ...(await this.toView(user)), quotaBalance };
  }

  async sign(user: Pick<User, 'id'>): Promise<string> {
    return this.jwt.signAsync({ sub: user.id.toString() });
  }

  /** BigInt 序列化为 string；敏感字段不外泄 */
  async toView(user: User) {
    return {
      id: user.id.toString(),
      nickname: user.nickname,
      phoneMasked: user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(7)}` : null,
      relation: user.relation,
      memberLevel: user.memberLevel,
      memberExpireAt: user.memberExpireAt?.toISOString() ?? null,
      realnamePassed: !!user.idCardNoHash,
      inviteCode: user.inviteCode,
    };
  }

  private async genInviteCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
      const dup = await this.prisma.user.findUnique({ where: { inviteCode: code }, select: { id: true } });
      if (!dup) return code;
    }
    throw new Error('邀请码生成失败，请重试');
  }
}
