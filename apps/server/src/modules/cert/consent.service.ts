import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SMS, SmsProvider } from '../../providers/interfaces';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptField } from '../../common/crypto';

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS) private readonly sms: SmsProvider,
  ) {}

  /** 子女授权短信（关系≠本人强制，§5.2） */
  async sendSms(userId: bigint, profileId: bigint, childPhone: string) {
    await this.assertProfile(userId, profileId);
    return this.sms.sendCode(childPhone, 'child_consent');
  }

  /** 验证码校验 + 授权声明勾选留痕（consent_record，PIPL；手机号加密存储 I5） */
  async verify(userId: bigint, profileId: bigint, childPhone: string, code: string, statementAccepted: boolean, statementVersion: string, ip: string) {
    const profile = await this.assertProfile(userId, profileId);
    if (!statementAccepted) {
      throw new BadRequestException('请先阅读并勾选《子女知情同意与授权声明》');
    }
    const ok = await this.sms.verifyCode(childPhone, 'child_consent', code);
    if (!ok) throw new BadRequestException('验证码不正确或已过期，请重新获取');

    const record = await this.prisma.consentRecord.create({
      data: {
        profileId: profile.id,
        childPhone: encryptField(childPhone),
        smsVerifiedAt: new Date(),
        statementVersion,
        ip,
      },
    });
    return { consentId: record.id.toString(), verifiedAt: record.smsVerifiedAt.toISOString() };
  }

  private async assertProfile(userId: bigint, profileId: bigint) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile || profile.ownerUserId !== userId) throw new NotFoundException('档案不存在');
    if (profile.relation === 'SELF') throw new BadRequestException('本人档案无需子女授权');
    return profile;
  }
}
