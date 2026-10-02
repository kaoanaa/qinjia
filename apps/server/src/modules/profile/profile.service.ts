import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Profile } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE, StorageProvider } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { PublishProfileDto } from './dto/publish-profile.dto';

const MATCH_NO_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去易混淆字符（§6.6 防枚举）
const MATCH_NO_LEN = 8;

interface PhotoItem {
  objectKey: string;
  sort: number;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageProvider,
  ) {}

  /** D1：多档案列表 */
  async listMine(userId: bigint) {
    const rows = await this.prisma.profile.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    });
    return { items: await Promise.all(rows.map((p) => this.toView(p))) };
  }

  /** 新建档案（草稿）。首份档案自动生效（无生效档案时的兜底） */
  async create(userId: bigint, dto: UpsertProfileDto) {
    const data = this.toProfileData(dto);
    const hasAny = await this.prisma.profile.count({ where: { ownerUserId: userId } });
    const profile = await this.prisma.profile.create({
      data: {
        ...data,
        matchNo: await this.genMatchNo(),
        ownerUserId: userId,
        isActive: hasAny === 0,
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { relation: dto.relation } });
    return this.toView(profile);
  }

  async getActiveView(userId: bigint) {
    const profile = await this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true } });
    if (!profile) throw new NotFoundException('还没有生效中的档案');
    return this.toView(profile);
  }

  async getMineView(userId: bigint, profileId: bigint) {
    return this.toView(await this.mustOwn(userId, profileId));
  }

  /** 编辑档案：曾进入审核链（APPROVED/PENDING）的，重置 PENDING 重审 */
  async update(userId: bigint, profileId: bigint, dto: UpsertProfileDto) {
    const current = await this.mustOwn(userId, profileId);
    const data = this.toProfileData(dto);
    const needsReAudit = current.auditStatus === 'APPROVED' || current.auditStatus === 'PENDING';
    const profile = await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        ...data,
        ...(needsReAudit ? { auditStatus: 'PENDING' as const, rejectReason: null } : {}),
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { relation: dto.relation } });
    return this.toView(profile);
  }

  /**
   * 发布（服务端强制校验，红线 I4 不可绕过）：
   * 1) 单身承诺书本次必须勾选 → 否则 403 COMMITMENT_REQUIRED（用例 5）
   * 2) 至少 1 张照片
   * 3) 实名通过（Step 6）→ 403 REALNAME_REQUIRED
   * 4) 子女授权 consent_record（Step 6，relation≠SELF）→ 403 CONSENT_REQUIRED
   */
  async publish(userId: bigint, profileId: bigint, dto: PublishProfileDto, ip: string) {
    const current = await this.mustOwn(userId, profileId);

    if (!dto.commitmentChecked) {
      throw BusinessException.forbidden('COMMITMENT_REQUIRED', '请勾选单身承诺书后再发布');
    }
    const photos = (current.photos as unknown as PhotoItem[]) ?? [];
    if (photos.length === 0) {
      throw new BadRequestException('发布前请至少上传 1 张照片');
    }
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { idCardNoHash: true } });
    if (!owner?.idCardNoHash) {
      throw BusinessException.forbidden('REALNAME_REQUIRED', '请先完成实名认证再发布');
    }
    if (current.relation !== 'SELF') {
      const consent = await this.prisma.consentRecord.count({ where: { profileId } });
      if (consent === 0) {
        throw BusinessException.forbidden('CONSENT_REQUIRED', '请子女完成短信授权后再发布');
      }
    }

    const profile = await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        auditStatus: 'PENDING',
        rejectReason: null,
        publishedAt: new Date(),
        singleCommitmentSignedAt: new Date(),
        singleCommitmentIp: ip,
        singleCommitmentVersion: dto.commitmentVersion,
      },
    });
    return this.toView(profile);
  }

  /** D1：切换生效档案。仅 APPROVED 可生效；不影响既有解锁/会话（无级联） */
  async switchActive(userId: bigint, profileId: bigint) {
    const target = await this.mustOwn(userId, profileId);
    if (target.auditStatus !== 'APPROVED') {
      throw new BadRequestException('仅审核通过的档案可以切换为生效档案');
    }
    await this.prisma.$transaction([
      this.prisma.profile.updateMany({ where: { ownerUserId: userId, isActive: true }, data: { isActive: false } }),
      this.prisma.profile.update({ where: { id: profileId }, data: { isActive: true } }),
    ]);
    return this.toView(await this.prisma.profile.findUniqueOrThrow({ where: { id: profileId } }));
  }

  /** 婚姻状况证明（D5）：仅存储 objectKeys，绿标由 Step 13 审核后台置位 */
  async attachMaritalProof(userId: bigint, profileId: bigint, objectKeys: string[]) {
    await this.mustOwn(userId, profileId);
    const profile = await this.prisma.profile.update({
      where: { id: profileId },
      data: { maritalProofKeys: JSON.stringify(objectKeys) },
    });
    return this.toView(profile);
  }

  async uploadToken(bucket: 'photos' | 'marital_proof' | 'id_card', mime?: string) {
    return this.storage.createUploadToken(bucket, mime ?? 'image/jpeg');
  }

  /**
   * 解锁/订单模块只读入口（模块间禁跨表直查）：目标档案 + 代理人摘要。
   * phone 仅在服务端判定"已解锁"后由 UnlockService 下发（红线 I3）。
   */
  async getUnlockTarget(profileId: bigint) {
    const p = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { owner: { select: { id: true, nickname: true, phone: true, memberLevel: true, memberExpireAt: true } } },
    });
    if (!p) throw new NotFoundException('档案不存在');
    return p;
  }

  /** 生效档案原始行（开会话需要 profileId；无则 null） */
  async getActiveProfileRaw(userId: bigint): Promise<Profile | null> {
    return this.prisma.profile.findFirst({ where: { ownerUserId: userId, isActive: true } });
  }

  // ==================== 私有 ====================

  private toProfileData(dto: UpsertProfileDto) {
    const photos: PhotoItem[] = (dto.photoObjectKeys ?? []).map((objectKey, sort) => ({ objectKey, sort }));
    return {
      relation: dto.relation,
      gender: dto.gender,
      birthYear: dto.birthYear,
      heightCm: dto.heightCm,
      education: dto.education,
      occupation: dto.occupation,
      incomeRange: dto.incomeRange,
      residenceCity: dto.residenceCity,
      residenceDistrict: dto.residenceDistrict,
      hometown: dto.hometown,
      hukou: dto.hukou,
      housing: dto.housing,
      car: dto.car,
      intro: dto.intro,
      photos: photos as unknown as Prisma.InputJsonValue,
      maritalStatus: dto.maritalStatus,
    };
  }

  private async mustOwn(userId: bigint, profileId: bigint): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile || profile.ownerUserId !== userId) throw new NotFoundException('档案不存在');
    return profile;
  }

  private async genMatchNo(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const candidate = 'QJ' + Array.from({ length: MATCH_NO_LEN }, () => MATCH_NO_ALPHABET[randomInt(MATCH_NO_ALPHABET.length)]).join('');
      const dup = await this.prisma.profile.findUnique({ where: { matchNo: candidate }, select: { id: true } });
      if (!dup) return candidate;
    }
    throw new Error('matchNo 生成失败，请重试');
  }

  private async toView(p: Profile) {
    const photos = (p.photos as unknown as PhotoItem[] | null) ?? [];
    return {
      id: p.id.toString(),
      matchNo: p.matchNo,
      isActive: p.isActive,
      relation: p.relation,
      gender: p.gender,
      birthYear: p.birthYear,
      heightCm: p.heightCm,
      education: p.education,
      occupation: p.occupation,
      incomeRange: p.incomeRange,
      residenceCity: p.residenceCity,
      residenceDistrict: p.residenceDistrict,
      hometown: p.hometown,
      hukou: p.hukou,
      housing: p.housing,
      car: p.car,
      intro: p.intro,
      photoObjectKeys: photos.sort((a, b) => a.sort - b.sort).map((x) => x.objectKey),
      maritalStatus: p.maritalStatus,
      hasMaritalProof: p.maritalProofKeys !== null,
      isMaritalVerified: p.isMaritalVerified,
      auditStatus: p.auditStatus,
      rejectReason: p.rejectReason,
      singleCommitmentSignedAt: p.singleCommitmentSignedAt?.toISOString() ?? null,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      /** 子女授权态（§5.2）：本人档案恒为 NOT_REQUIRED；否则以 consent_record 留痕判定 */
      consentStatus:
        p.relation === 'SELF'
          ? 'NOT_REQUIRED'
          : (await this.prisma.consentRecord.count({ where: { profileId: p.id } })) > 0
            ? 'DONE'
            : 'PENDING',
    };
  }
}
