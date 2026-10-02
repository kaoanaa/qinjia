import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { REALNAME, RealnameProvider } from '../../providers/interfaces';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { ReferralRewardTrigger } from './referral-reward-trigger';

interface OcrDetail {
  name: string;
  idCardNoMasked: string;
  idCardNoHash: string;
}

@Injectable()
export class CertService {
  private readonly logger = new Logger(CertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REALNAME) private readonly realname: RealnameProvider,
    private readonly quota: QuotaService,
    private readonly referralTrigger: ReferralRewardTrigger,
  ) {}

  /** 身份证 OCR：provider 返回掩码+哈希，原文不落库（I5）。哈希暂存 cert.detail，人脸通过后才写 user */
  async idCardOcr(userId: bigint, objectKey: string) {
    const r = await this.realname.idCardOcr(objectKey);
    const cert = await this.prisma.certification.create({
      data: {
        userId,
        type: 'ID_CARD_OCR',
        result: 'PASSED',
        provider: 'mock',
        detail: { name: r.name, idCardNoMasked: r.idCardNoMasked, idCardNoHash: r.idCardNoHash } as unknown as object,
      },
    });
    return { name: r.name, idCardNoMasked: r.idCardNoMasked, certId: cert.id.toString() };
  }

  /** 发起人脸核身会话 */
  async faceInit(userId: bigint, certId?: string) {
    const ocr = await this.prisma.certification.findFirst({
      where: { userId, type: 'ID_CARD_OCR', result: 'PASSED', ...(certId ? { id: BigInt(certId) } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!ocr) throw new NotFoundException('请先完成身份证 OCR');
    const sessionId = randomUUID();
    await this.prisma.certification.create({
      data: { userId, type: 'FACE', result: 'PENDING', provider: 'mock', sessionId },
    });
    // 真实实现：向 provider 申请核身 bizUrl/nonce（TencentFace 等），此处按 sessionId 关联结果
    return { sessionId, verifyUrl: `https://mock-face.local/verify?sessionId=${sessionId}` };
  }

  /**
   * 核身结果（§3.1 F→H）：
   * 通过 → 写 user.idCardNoHash（三唯一）→ 解冻 frozen 额度 → 触发邀请奖励埋点（发奖在 Step 15）。
   * 同身份证已被他人占用 → 实名不生效、新手礼保持 frozen（用例 15 无福利）。
   */
  async faceVerify(userId: bigint, sessionId: string) {
    const faceCert = await this.prisma.certification.findUnique({ where: { sessionId } });
    if (!faceCert || faceCert.userId !== userId) throw new NotFoundException('核身会话不存在');

    if (faceCert.result === 'PASSED') {
      return { passed: true, duplicateIdCard: false, quotaBalance: await this.quota.getBalance(userId) }; // 幂等
    }

    const ocr = await this.prisma.certification.findFirst({
      where: { userId, type: 'ID_CARD_OCR', result: 'PASSED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ocr) throw new NotFoundException('请先完成身份证 OCR');
    const detail = ocr.detail as unknown as OcrDetail;

    const r = await this.realname.faceVerify({ sessionId });
    if (!r.passed) {
      await this.prisma.certification.update({ where: { id: faceCert.id }, data: { result: 'FAILED', verifyToken: r.verifyToken } });
      return { passed: false, duplicateIdCard: false, quotaBalance: await this.quota.getBalance(userId) };
    }
    await this.prisma.certification.update({ where: { id: faceCert.id }, data: { result: 'PASSED', verifyToken: r.verifyToken } });

    // 三唯一：身份证哈希已被其他账号占用 → 无福利（保持 frozen），本账号不写 hash
    const occupied = await this.prisma.user.findFirst({
      where: { idCardNoHash: detail.idCardNoHash, id: { not: userId } },
      select: { id: true },
    });
    let duplicateIdCard = !!occupied;
    if (!duplicateIdCard) {
      try {
        await this.prisma.user.update({ where: { id: userId }, data: { idCardNoHash: detail.idCardNoHash } });
      } catch {
        duplicateIdCard = true; // 并发注册同证：唯一约束兜底
      }
    }

    if (!duplicateIdCard) {
      await this.prisma.$transaction((tx) => this.quota.unfreezeTxFrozen(tx, userId));
      await this.referralTrigger.onInviteeRealnamePassed(userId);
    } else {
      this.logger.warn(`user=${userId} 身份证与他账号重复（三唯一），新手礼保持 frozen（用例 15）`);
    }

    return { passed: true, duplicateIdCard, quotaBalance: await this.quota.getBalance(userId) };
  }
}
