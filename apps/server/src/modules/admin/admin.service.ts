import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AdminUser, AuditStatus, CertResult, CertType, PayStatus, Prisma, RefundStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter } from '../../providers/interfaces';
import { AdminContext } from './admin-auth';
import { MiscService } from '../misc/misc.service';
import { UnlockService } from '../unlock/unlock.service';
import { OrderService } from '../order/order.service';

const CONFIG_KEY_VALUES = Object.values(ConfigKeys) as string[];

/**
 * 管理后台（PRD §5.13，Step 13）。红线 I1：配置中心是唯一写入口，保存即失效 DbConfigCenter 缓存；
 * 关键操作（审核/退款/改配置）一律写 AdminAuditLog。
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    private readonly misc: MiscService,
    private readonly unlock: UnlockService,
    private readonly order: OrderService,
  ) {}

  // ==================== 登录 ====================

  async login(username: string, password: string): Promise<AdminUser | null> {
    const admin = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!admin || !admin.enabled || !bcrypt.compareSync(password, admin.passwordHash)) return null;
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    return admin;
  }

  // ==================== 审核工作台（档案+婚姻证明选审） ====================

  async listAuditProfiles(status: string | undefined, page: number, size: number) {
    const where = status ? { auditStatus: status as AuditStatus } : { auditStatus: 'PENDING' as AuditStatus };
    const [total, rows] = await Promise.all([
      this.prisma.profile.count({ where }),
      this.prisma.profile.findMany({ where, include: { owner: { select: { nickname: true, phone: true, idCardNoHash: true } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * size, take: size }),
    ]);
    return { total, items: rows.map((p) => this.serializeAuditProfile(p)) };
  }

  async auditProfile(admin: AdminContext, profileId: bigint, dto: { decision: string; reason?: string; maritalVerified?: 'PASS' | 'FAIL' }) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('档案不存在');
    if (profile.auditStatus !== 'PENDING') throw new ConflictException('仅待审档案可裁决');

    let updated;
    let refundedUnlocks: string[] = [];
    if (dto.decision === 'APPROVE') {
      updated = await this.prisma.profile.update({
        where: { id: profileId },
        data: {
          auditStatus: 'APPROVED',
          rejectReason: null,
          ...(dto.maritalVerified ? { isMaritalVerified: dto.maritalVerified === 'PASS' } : {}),
        },
      });
      await this.misc.notifyByTemplate(profile.ownerUserId, 'audit', 'auditPass');
    } else {
      updated = await this.prisma.profile.update({
        where: { id: profileId },
        data: { auditStatus: 'REJECTED', rejectReason: dto.reason ?? '内容不符合规范', isActive: false, publishedAt: null },
      });
      // §6.1 违规下架：该档案的 active 解锁 → Refunded（额度解锁返还 remaining+1）
      const active = await this.prisma.unlockRecord.findMany({ where: { targetProfileId: profileId, status: 'ACTIVE' }, select: { id: true } });
      for (const rec of active) {
        await this.unlock.refundQuotaUnlock(rec.id);
        refundedUnlocks.push(rec.id.toString());
      }
      await this.misc.notifyByTemplate(profile.ownerUserId, 'audit', 'auditReject');
    }
    await this.audit(admin, 'profile_audit', 'profile', profileId, { status: profile.auditStatus }, { status: updated.auditStatus, decision: dto.decision, reason: dto.reason ?? null, maritalVerified: dto.maritalVerified ?? null });
    return { profileId: updated.id.toString(), auditStatus: updated.auditStatus, refundedUnlocks };
  }

  /** 实名复核队列（§5.13）：人脸通过记录抽查 */
  async listCertifications(page: number, size: number) {
    const where = { type: CertType.FACE, result: CertResult.PASSED };
    const [total, rows] = await Promise.all([
      this.prisma.certification.count({ where }),
      this.prisma.certification.findMany({ where, include: { user: { select: { nickname: true, phone: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    return {
      total,
      items: rows.map((c) => ({
        id: c.id.toString(),
        userId: c.userId.toString(),
        nickname: c.user.nickname,
        phoneMasked: this.maskPhone(c.user.phone),
        provider: c.provider,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async reviewCertification(admin: AdminContext, certId: bigint, dto: { decision: string; reason?: string }) {
    const cert = await this.prisma.certification.findUnique({ where: { id: certId } });
    if (!cert || cert.type !== CertType.FACE) throw new NotFoundException('核身记录不存在');
    if (dto.decision === 'REVOKE') {
      // 复核不通过：撤销实名（清哈希三唯一占用）+ 冻结其 active 额度（新手礼语义回到未激活态）
      await this.prisma.$transaction([
        this.prisma.certification.update({ where: { id: certId }, data: { result: CertResult.FAILED } }),
        this.prisma.user.update({ where: { id: cert.userId }, data: { idCardNoHash: null } }),
        this.prisma.memberQuota.updateMany({ where: { userId: cert.userId, status: 'ACTIVE' }, data: { status: 'FROZEN' } }),
      ]);
      await this.misc.notify(cert.userId, 'risk', '实名复核未通过', '您的实名认证复核未通过，相关权益已暂停，请联系客服处理');
    }
    await this.audit(admin, `cert_${dto.decision.toLowerCase()}`, 'certification', certId, { result: cert.result }, { reason: dto.reason ?? null });
    return { certId: cert.id.toString(), decision: dto.decision };
  }

  // ==================== 用户 / 额度 / 订单（查询） ====================

  async listUsers(keyword: string | undefined, page: number, size: number) {
    const where = keyword
      ? {
          OR: [
            { phone: { contains: keyword } },
            { nickname: { contains: keyword } },
            { openid: keyword },
            ...( /^\d+$/.test(keyword) ? [{ id: BigInt(keyword) }] : []),
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: [{ id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    return {
      total,
      items: rows.map((u) => ({
        id: u.id.toString(),
        nickname: u.nickname,
        phoneMasked: this.maskPhone(u.phone),
        memberLevel: u.memberLevel,
        memberExpireAt: u.memberExpireAt?.toISOString() ?? null,
        status: u.status,
        // 三唯一标识（§6.6 防刷排查，只回布尔不回原值，I5）
        hasUnionid: !!u.unionid,
        hasDeviceFingerprint: !!u.deviceFingerprint,
        hasIdCard: !!u.idCardNoHash,
        newbieRewardClaimed: u.newbieRewardClaimed,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  /** 额度账本只读（含流水） */
  async listQuotas(userId: bigint | undefined, page: number, size: number) {
    const where = userId ? { userId } : {};
    const [total, batches] = await Promise.all([
      this.prisma.memberQuota.count({ where }),
      this.prisma.memberQuota.findMany({ where, orderBy: [{ id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    const logs = batches.length
      ? await this.prisma.quotaTxLog.findMany({ where: { quotaId: { in: batches.map((b) => b.id) } }, orderBy: { createdAt: 'desc' }, take: 200 })
      : [];
    return {
      total,
      items: batches.map((b) => ({
        id: b.id.toString(),
        userId: b.userId.toString(),
        source: b.source,
        total: b.total,
        remaining: b.remaining,
        status: b.status,
        expireAt: b.expireAt.toISOString(),
        createdAt: b.createdAt.toISOString(),
      })),
      logs: logs.map((l) => ({
        id: l.id.toString(),
        quotaId: l.quotaId?.toString() ?? null,
        userId: l.userId.toString(),
        reason: l.reason,
        change: l.change,
        refType: l.refType,
        refId: l.refId?.toString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  async listOrders(payStatus: string | undefined, page: number, size: number) {
    const where = payStatus ? { payStatus: payStatus as PayStatus } : {};
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, orderBy: [{ id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    return {
      total,
      items: rows.map((o) => ({
        id: o.id.toString(),
        userId: o.userId.toString(),
        type: o.type,
        bizRef: o.bizRef,
        amountCent: o.amountCent,
        couponDeductCent: o.couponDeductCent,
        outTradeNo: o.outTradeNo,
        payStatus: o.payStatus,
        refundStatus: o.refundStatus,
        refundAmountCent: o.refundAmountCent,
        paidAt: o.paidAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  // ==================== 配置中心（唯一写入口，红线 I1） ====================

  async listConfigs() {
    const rows = await this.prisma.rewardConfig.findMany({ orderBy: { configKey: 'asc' } });
    return rows.map((r) => ({ configKey: r.configKey, value: r.value, updatedAt: r.updatedAt.toISOString() }));
  }

  async getConfig(key: string) {
    const row = await this.prisma.rewardConfig.findUnique({ where: { configKey: key } });
    if (!row) throw new NotFoundException('配置项不存在');
    return { configKey: row.configKey, value: row.value };
  }

  async updateConfig(admin: AdminContext, key: string, value: Record<string, unknown>) {
    if (!CONFIG_KEY_VALUES.includes(key)) throw new BadRequestException('未知配置项（§11 清单外禁止写入）');
    const before = await this.prisma.rewardConfig.findUnique({ where: { configKey: key } });
    const row = await this.prisma.rewardConfig.upsert({
      where: { configKey: key },
      update: { value: value as object, updatedBy: admin.username },
      create: { configKey: key, value: value as object, updatedBy: admin.username },
    });
    // 保存即失效缓存（实时生效，Verify）；MockConfigCenter 无缓存则跳过
    (this.config as { invalidate?: (key?: string) => void }).invalidate?.(key);
    await this.audit(admin, 'config_update', 'reward_config', null, { value: before?.value ?? null }, { value: row.value }, key);
    return { configKey: row.configKey, value: row.value };
  }

  // ==================== 运营位管理 ====================

  async listOpsSlots() {
    const rows = await this.prisma.opsSlot.findMany({ orderBy: [{ type: 'asc' }, { sort: 'asc' }, { id: 'asc' }] });
    return rows.map((s) => ({
      id: s.id.toString(),
      type: s.type,
      content: s.content,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      sort: s.sort,
      enabled: s.enabled,
    }));
  }

  async upsertOpsSlot(admin: AdminContext, dto: { id?: string; type: string; content: Record<string, unknown>; startAt: string; endAt: string; sort?: number; enabled?: string }) {
    const data = {
      type: dto.type as never,
      content: dto.content as object,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      sort: dto.sort ?? 0,
      enabled: dto.enabled !== 'false',
    };
    if (Number.isNaN(data.startAt.getTime()) || Number.isNaN(data.endAt.getTime())) throw new BadRequestException('时间格式非法');
    const row = dto.id
      ? await this.prisma.opsSlot.update({ where: { id: BigInt(dto.id) }, data })
      : await this.prisma.opsSlot.create({ data });
    await this.audit(admin, 'ops_slot_upsert', 'ops_slot', null, null, { id: row.id.toString(), type: row.type, enabled: row.enabled }, String(row.id));
    return { id: row.id.toString(), type: row.type, enabled: row.enabled };
  }

  // ==================== 工单处理（SLA 倒计时） ====================

  async listTickets(status?: string) {
    const rows = await this.prisma.ticket.findMany({
      where: status ? { status: status as never } : {},
      include: { user: { select: { nickname: true } } },
      orderBy: [{ slaDeadline: 'asc' }, { id: 'asc' }], // 首响倒计时升序（超时最急）
    });
    const now = Date.now();
    return rows.map((t) => ({
      id: t.id.toString(),
      userId: t.userId.toString(),
      userNickname: t.user.nickname,
      type: t.type,
      content: t.content,
      images: t.images,
      status: t.status,
      slaDeadline: t.slaDeadline.toISOString(),
      slaRemainingMs: t.slaDeadline.getTime() - now, // 负值 = 已超时
      handlerNote: t.handlerNote,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async updateTicket(admin: AdminContext, ticketId: bigint, dto: { status?: string; handlerNote?: string }) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');
    const row = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        ...(dto.status ? { status: dto.status as never } : {}),
        ...(dto.handlerNote ? { handlerNote: dto.handlerNote } : {}),
        handlerId: admin.id,
      },
    });
    await this.audit(admin, 'ticket_update', 'ticket', ticketId, { status: ticket.status }, { status: row.status, note: dto.handlerNote ?? null });
    // 处理结果回执给提交人（§5.12 系统消息旁路）
    if (dto.handlerNote) {
      await this.misc.notify(ticket.userId, 'activity', '工单有新回复', dto.handlerNote);
    }
    return { id: row.id.toString(), status: row.status };
  }

  // ==================== IM 风控台 ====================

  async listRiskEvents(page: number, size: number) {
    const [total, rows] = await Promise.all([
      this.prisma.riskEvent.count(),
      this.prisma.riskEvent.findMany({ orderBy: { id: 'desc' }, skip: (page - 1) * size, take: size }),
    ]);
    return { total, items: rows.map((r) => ({ id: r.id.toString(), userId: r.userId.toString(), category: r.category, code: r.code, detail: r.detail, createdAt: r.createdAt.toISOString() })) };
  }

  // ==================== 数据看板（§5.13 漏斗） ====================

  async funnel(from: Date, to: Date) {
    const [register, realnamePassed, unlocks, paidAgg, refunds, invitedRewarded] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.certification.count({ where: { type: CertType.FACE, result: CertResult.PASSED, createdAt: { gte: from, lte: to } } }),
      this.prisma.unlockRecord.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.order.aggregate({ _count: { id: true }, _sum: { amountCent: true }, where: { payStatus: PayStatus.PAID, paidAt: { gte: from, lte: to } } }),
      this.prisma.order.count({ where: { refundStatus: { in: [RefundStatus.REFUNDING, RefundStatus.REFUNDED] }, updatedAt: { gte: from, lte: to } } }),
      this.prisma.referral.count({ where: { rewardStatus: 'REWARDED', rewardedAt: { gte: from, lte: to } } }),
    ]);
    return {
      register,
      realnamePassed,
      unlocks,
      paidOrders: paidAgg._count.id,
      paidAmountCent: paidAgg._sum.amountCent ?? 0,
      refunds,
      invitedRewarded,
    };
  }

  // ==================== 支付对账（§6.6，运营按需触发；定时任务每日自动跑） ====================

  async runReconciliation(admin: AdminContext, date?: string) {
    const report = await this.order.reconcileDay(date);
    await this.audit(admin, 'reconciliation_run', 'order', null, null, report as unknown as object, report.date);
    return report;
  }

  // ==================== 私有 ====================

  private serializeAuditProfile(p: Prisma.ProfileGetPayload<{ include: { owner: { select: { nickname: true; phone: true; idCardNoHash: true } } } }>) {
    const proofKeys = p.maritalProofKeys ? (JSON.parse(p.maritalProofKeys) as string[]) : [];
    return {
      id: p.id.toString(),
      matchNo: p.matchNo,
      ownerUserId: p.ownerUserId.toString(),
      ownerNickname: p.owner.nickname,
      ownerPhoneMasked: this.maskPhone(p.owner.phone),
      realnamePassed: !!p.owner.idCardNoHash,
      relation: p.relation,
      gender: p.gender,
      birthYear: p.birthYear,
      heightCm: p.heightCm,
      education: p.education,
      occupation: p.occupation,
      residenceCity: p.residenceCity,
      intro: p.intro,
      auditStatus: p.auditStatus,
      rejectReason: p.rejectReason,
      isMaritalVerified: p.isMaritalVerified,
      maritalProofPending: proofKeys.length > 0 && !p.isMaritalVerified, // 选审标记（D5）
      hasMaritalProof: proofKeys.length > 0,
      commitmentSigned: !!p.singleCommitmentSignedAt,
      consentPending: p.relation !== 'SELF' && !p.singleCommitmentSignedAt,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private maskPhone(phone: string | null): string | null {
    if (!phone || phone.length < 7) return null;
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private async audit(admin: AdminContext, action: string, targetType: string, targetId: bigint | null, before: unknown, after: unknown, targetIdStr?: string) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action,
        targetType,
        targetId: targetIdStr ?? targetId?.toString() ?? '',
        before: (before ?? undefined) as object | undefined,
        after: (after ?? undefined) as object | undefined,
      },
    });
  }
}
