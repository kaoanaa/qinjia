import {
  BadRequestException,
  forwardRef,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CouponScope, OrderType, PayStatus, Prisma, QuotaSource, UnlockPayType, UserCouponStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, WX_PAY, WxPay } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { ProfileService } from '../profile/profile.service';
import { QuotaService } from '../quota/quota.service';
import { UnlockService } from '../unlock/unlock.service';

export interface PrepayOrderView {
  orderId: string;
  outTradeNo: string;
  amountCent: number;
  couponDeductCent: number;
  confirmRequired: boolean;
  paySignParams: Record<string, string>;
}

interface MemberPlanCfg {
  planId: string;
  name: string;
  days: number;
  quota: number;
  amountCent: number;
}

export interface ReconcileReport {
  date: string;
  billCount: number;
  localCount: number;
  missingInSystem: string[]; // 账单有成交、系统无订单（漏记账/串单）
  missingInBill: string[]; // 系统标 PAID、账单无（未真实到账/多发）
  amountMismatch: string[]; // 双方有但金额不符
}

/**
 * 订单与支付回调（§6.1 第 3 步 + §5.9）。金额全部以「分」计（I5 资金安全）。
 * 回调幂等双保险：payStatus 条件更新门闸 + transactionId 唯一约束。
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
    private readonly quota: QuotaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(WX_PAY) private readonly wxpay: WxPay,
    @Inject(forwardRef(() => UnlockService)) private readonly unlock: UnlockService,
  ) {}

  /** POST /orders：会员购买或单次解锁支付 */
  async createOrder(
    userId: bigint,
    dto: { type: string; planId?: string; targetProfileId?: string; userCouponId?: string },
  ): Promise<PrepayOrderView> {
    if (dto.type === OrderType.MEMBER) {
      if (!dto.planId) throw new BadRequestException('type=MEMBER 必须提供 planId');
      return this.createMemberOrder(userId, dto.planId, dto.userCouponId ? BigInt(dto.userCouponId) : undefined);
    }
    if (dto.type === OrderType.UNLOCK_ONCE) {
      if (!dto.targetProfileId) throw new BadRequestException('type=UNLOCK_ONCE 必须提供 targetProfileId');
      const r = await this.createUnlockOrder(userId, BigInt(dto.targetProfileId), dto.userCouponId ? BigInt(dto.userCouponId) : undefined, true);
      if (r.prepay) return r.prepay;
      return { orderId: (r.orderId ?? '').toString(), outTradeNo: r.outTradeNo!, amountCent: 0, couponDeductCent: r.couponDeductCent!, confirmRequired: false, paySignParams: {} };
    }
    throw new BadRequestException('未知订单类型');
  }

  /**
   * 解锁模块 ③ 入口：单次付费订单。券全额抵扣（应付=0）时不拉起支付，直接完成解锁。
   */
  async createUnlockOrder(
    userId: bigint,
    targetProfileId: bigint,
    userCouponId?: bigint,
    riskConfirmed = false,
  ): Promise<{ prepay?: PrepayOrderView; immediate?: boolean; unlockId?: bigint; orderId?: bigint; outTradeNo?: string; couponDeductCent?: number }> {
    const target = await this.profile.getUnlockTarget(targetProfileId);
    if (target.ownerUserId === userId) throw new BadRequestException('不能解锁自己的档案');
    if (target.auditStatus !== 'APPROVED' || !target.publishedAt) throw new NotFoundException('档案未上线');

    const price = await this.oncePriceCent();
    const coupon = userCouponId ? await this.validateCoupon(userId, userCouponId, CouponScope.UNLOCK, price) : null;
    const deduct = coupon ? Math.min(coupon.template.amountCent, price) : 0;
    const payable = price - deduct;
    const outTradeNo = this.genOutTradeNo();

    if (payable === 0) {
      const done = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId, type: OrderType.UNLOCK_ONCE, bizRef: targetProfileId.toString(),
            amountCent: price, couponDeductCent: deduct, userCouponId: coupon?.id,
            outTradeNo, payStatus: PayStatus.PAID, transactionId: `FREE_${outTradeNo}`, paidAt: new Date(),
          },
        });
        await this.reserveCouponTx(tx, coupon, order.id);
        const days = await this.unlockDays();
        const rec = await this.unlock.createUnlockTx(tx, {
          userId, target, payType: UnlockPayType.COUPON, days,
          orderId: order.id, userCouponId: coupon?.id, riskConfirmed,
        });
        return { rec, order };
      });
      this.logger.log(`user=${userId} 券全额抵扣解锁 profile=${targetProfileId}`);
      return { immediate: true, unlockId: done.rec.id, orderId: done.order.id, outTradeNo, couponDeductCent: deduct };
    }

    const prepay = await this.jsapiPrepay(userId, {
      type: OrderType.UNLOCK_ONCE,
      bizRef: targetProfileId.toString(),
      amountCent: price,
      couponDeductCent: deduct,
      userCouponId: coupon?.id,
      outTradeNo,
      description: '单次解锁',
    });
    return { prepay, couponDeductCent: deduct };
  }

  /** 支付回调完成（幂等）：MEMBER→时长+额度（D10/D2），UNLOCK_ONCE→写解锁记录+开会话 */
  async handlePaidCallback(outTradeNo: string, transactionId: string, success = true) {
    const order = await this.prisma.order.findUnique({ where: { outTradeNo } });
    if (!order) throw new NotFoundException('订单不存在');
    if (!success) return { handled: false, reason: 'PAY_FAILED' as const };
    if (order.payStatus === PayStatus.PAID) return { handled: true, idempotent: true }; // 重复回调

    let fulfilled = false;
    await this.prisma.$transaction(async (tx) => {
      const gate = await tx.order.updateMany({
        where: { id: order.id, payStatus: PayStatus.CREATED },
        data: { payStatus: PayStatus.PAID, transactionId, paidAt: new Date() },
      });
      if (gate.count !== 1) return; // 并发回调：仅一个事务通过门闸
      fulfilled = true;

      if (order.type === OrderType.MEMBER) {
        const plan = await this.memberPlan(order.bizRef ?? '');
        await this.quota.applyMembershipTx(tx, order.userId, { days: plan.days, quota: plan.quota, source: QuotaSource.PAID, orderId: order.id });
        await tx.order.update({ where: { id: order.id }, data: { quotaGranted: true } });
      } else {
        const target = await this.profile.getUnlockTarget(BigInt(order.bizRef ?? '0'));
        const days = await this.unlockDays();
        await this.unlock.createUnlockTx(tx, {
          userId: order.userId,
          target,
          payType: order.userCouponId ? UnlockPayType.COUPON : UnlockPayType.ONCE,
          days,
          orderId: order.id,
          userCouponId: order.userCouponId ?? undefined,
          // 付费回调分支：风险确认在 /unlock 请求时已通过 412 门闸（用例 13），此处按目标态留痕
          riskConfirmed: !target.isMaritalVerified,
        });
      }
    });
    this.logger.log(`订单完成 outTradeNo=${outTradeNo} fulfilled=${fulfilled}`);
    return { handled: true, idempotent: !fulfilled };
  }

  async getOrder(userId: bigint, orderId: bigint) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('订单不存在');
    return {
      id: order.id.toString(),
      type: order.type,
      amountCent: order.amountCent,
      couponDeductCent: order.couponDeductCent,
      payStatus: order.payStatus,
      refundStatus: order.refundStatus,
      paidAt: order.paidAt?.toISOString() ?? null,
    };
  }

  /** 在售套餐（配置下发，禁止前端硬编码） */
  async listPlans(): Promise<Array<MemberPlanCfg & { originalAmountCent: number | null }>> {
    const c = await this.config.get<{ options: MemberPlanCfg[] }>(ConfigKeys.PAID_MEMBER_PLAN);
    return c.options.map((o) => ({ ...o, originalAmountCent: null }));
  }

  /** 会员卡（§5.9）：等级读时判定过期→NONE；权益与提醒节点全部走配置 */
  async memberCard(userId: bigint) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = Date.now();
    const alive = !!user.memberExpireAt && user.memberExpireAt.getTime() > now;
    const level = alive ? user.memberLevel : 'NONE';
    const [quota, copy, remind] = await Promise.all([
      this.quota.getBalance(userId),
      this.config.get<{ privileges?: Array<{ key: string; label: string }> }>(ConfigKeys.COPYWRITING),
      this.config.get<{ trialBeforeDays: number; paidBeforeDays: number }>(ConfigKeys.REMIND_NODES),
    ]);
    let nextRemindAt: string | null = null;
    if (alive && (level === 'TRIAL' || level === 'PAID')) {
      const beforeDays = level === 'TRIAL' ? remind.trialBeforeDays : remind.paidBeforeDays;
      const t = user.memberExpireAt!.getTime() - beforeDays * 864e5;
      nextRemindAt = new Date(t).toISOString(); // 提醒任务在 Step 15 接入（订阅消息）
    }
    return {
      level,
      expireAt: alive ? user.memberExpireAt!.toISOString() : null,
      quota,
      privileges: (copy.privileges ?? []).map((p) => ({ ...p, enabled: level === 'PAID' || level === 'TRIAL' })),
      renewRemind: { nextRemindAt, couponIssued: false },
    };
  }

  // ==================== 私有 ====================

  private async createMemberOrder(userId: bigint, planId: string, userCouponId?: bigint): Promise<PrepayOrderView> {
    const plan = await this.memberPlan(planId);
    const coupon = userCouponId ? await this.validateCoupon(userId, userCouponId, CouponScope.MEMBER, plan.amountCent) : null;
    const deduct = coupon ? Math.min(coupon.template.amountCent, plan.amountCent) : 0;
    const payable = plan.amountCent - deduct;
    const outTradeNo = this.genOutTradeNo();
    if (payable === 0) {
      await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId, type: OrderType.MEMBER, bizRef: planId, amountCent: plan.amountCent,
            couponDeductCent: deduct, userCouponId: coupon?.id, outTradeNo,
            payStatus: PayStatus.PAID, transactionId: `FREE_${outTradeNo}`, paidAt: new Date(),
          },
        });
        await this.reserveCouponTx(tx, coupon, order.id);
        await this.quota.applyMembershipTx(tx, userId, { days: plan.days, quota: plan.quota, source: QuotaSource.PAID, orderId: order.id });
        await tx.order.update({ where: { id: order.id }, data: { quotaGranted: true } });
      });
      return { orderId: '', outTradeNo, amountCent: 0, couponDeductCent: deduct, confirmRequired: false, paySignParams: {} };
    }
    return this.jsapiPrepay(userId, {
      type: OrderType.MEMBER, bizRef: planId, amountCent: plan.amountCent,
      couponDeductCent: deduct, userCouponId: coupon?.id, outTradeNo, description: `会员-${plan.name}`,
    });
  }

  /** 预下单：创建 Order(CREATED) + 券核销预留 → JSAPI 下单返回调起参数 */
  private async jsapiPrepay(
    userId: bigint,
    p: { type: OrderType; bizRef: string; amountCent: number; couponDeductCent: number; userCouponId?: bigint; outTradeNo: string; description: string },
  ): Promise<PrepayOrderView> {
    const payable = p.amountCent - p.couponDeductCent;
    const threshold = await this.config.get<{ amountCent: number }>(ConfigKeys.BIG_PAY_THRESHOLD);
    const confirmRequired = payable >= threshold.amountCent; // ≥¥500 二次确认（§5.10，子女协助 P1）

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId, type: p.type, bizRef: p.bizRef, amountCent: p.amountCent,
          couponDeductCent: p.couponDeductCent, userCouponId: p.userCouponId, outTradeNo: p.outTradeNo,
        },
      });
      if (p.userCouponId) {
        const uc = await this.validateCoupon(userId, p.userCouponId, p.type === OrderType.MEMBER ? CouponScope.MEMBER : CouponScope.UNLOCK, p.amountCent);
        await this.reserveCouponTx(tx, uc, created.id);
      }
      return created;
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { openid: true } });
    const { paySignParams } = await this.wxpay.createJsapiOrder({
      outTradeNo: p.outTradeNo, amountCent: payable, description: p.description, openid: user.openid,
    });
    return {
      orderId: order.id.toString(), outTradeNo: p.outTradeNo, amountCent: payable,
      couponDeductCent: p.couponDeductCent, confirmRequired, paySignParams,
    };
  }

  private async validateCoupon(userId: bigint, couponId: bigint, scope: CouponScope, listPriceCent: number) {
    const uc = await this.prisma.userCoupon.findUnique({ where: { id: couponId }, include: { template: true } });
    if (!uc || uc.userId !== userId) throw new BusinessException(HttpStatus.BAD_REQUEST, 'COUPON_INVALID', '优惠券不存在');
    if (uc.status !== UserCouponStatus.UNUSED || uc.expireAt.getTime() <= Date.now() || !uc.template.status) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, 'COUPON_INVALID', '优惠券已使用或已过期');
    }
    if (uc.template.scope !== scope) throw new BusinessException(HttpStatus.BAD_REQUEST, 'COUPON_INVALID', '优惠券适用范围不符');
    if (listPriceCent < uc.template.minAmountCent) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, 'COUPON_INVALID', '订单金额未达到券使用门槛');
    }
    return uc;
  }

  /** 券核销预留（下单即占，防一券多单） */
  private async reserveCouponTx(tx: Prisma.TransactionClient, uc: { id: bigint } | null, orderId: bigint) {
    if (!uc) return;
    const gate = await tx.userCoupon.updateMany({ where: { id: uc.id, status: UserCouponStatus.UNUSED }, data: { status: UserCouponStatus.USED, orderId } });
    if (gate.count !== 1) throw new BusinessException(HttpStatus.BAD_REQUEST, 'COUPON_INVALID', '优惠券已被使用');
  }

  private async memberPlan(planId: string): Promise<MemberPlanCfg> {
    const c = await this.config.get<{ options: MemberPlanCfg[] }>(ConfigKeys.PAID_MEMBER_PLAN);
    const plan = c.options.find((o) => o.planId === planId);
    if (!plan) throw new BadRequestException('套餐不存在');
    return plan;
  }

  private async oncePriceCent(): Promise<number> {
    const c = await this.config.get<{ amountCent: number }>(ConfigKeys.UNLOCK_ONCE_PRICE);
    return c.amountCent;
  }

  private async unlockDays(): Promise<number> {
    const c = await this.config.get<{ days: number }>(ConfigKeys.UNLOCK_VALIDITY);
    if (!c?.days) throw new Error('缺少 unlock_validity 配置');
    return c.days;
  }

  /**
   * 支付对账日切（§6.6 防刷/资金安全）：拉取指定日期微信账单，与本地 PAID 订单逐笔比对。
   * 差异分类：账单有/本地无（漏单或串单）、本地有/账单无（未到账或多发）、金额不符。
   * 只读不改账；差异打告警日志供人工介入。date 形如 YYYYMMDD，缺省=昨日。
   */
  async reconcileDay(date?: string): Promise<ReconcileReport> {
    const day = date ?? this.yesterdayYmd();
    const report: ReconcileReport = {
      date: day,
      billCount: 0,
      localCount: 0,
      missingInSystem: [] as string[],
      missingInBill: [] as string[],
      amountMismatch: [] as string[],
    };

    const billRows = await this.wxpay.downloadBill(day);
    const billMap = new Map<string, number>(); // outTradeNo → amountCent
    for (const line of billRows) {
      const parsed = this.parseBillLine(line);
      if (parsed) billMap.set(parsed.outTradeNo, parsed.amountCent);
    }

    // 本地当日成交（按 paidAt 落在该自然日）
    const start = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`);
    const end = new Date(start.getTime() + 864e5);
    const local = await this.prisma.order.findMany({
      where: { payStatus: PayStatus.PAID, paidAt: { gte: start, lt: end } },
      select: { outTradeNo: true, amountCent: true, couponDeductCent: true },
    });

    report.billCount = billMap.size;
    report.localCount = local.length;
    for (const o of local) {
      const payable = o.amountCent - o.couponDeductCent; // 账单记录实付（券后）
      const billed = billMap.get(o.outTradeNo);
      if (billed === undefined) report.missingInBill.push(o.outTradeNo);
      else if (billed !== payable) report.amountMismatch.push(o.outTradeNo);
    }
    const localNos = new Set(local.map((o) => o.outTradeNo));
    for (const no of billMap.keys()) if (!localNos.has(no)) report.missingInSystem.push(no);

    const diffTotal = report.missingInBill.length + report.missingInSystem.length + report.amountMismatch.length;
    if (diffTotal > 0) {
      this.logger.error(`支付对账差异 ${day}: 本地有账单无=${report.missingInBill.length} 账单有本地无=${report.missingInSystem.length} 金额不符=${report.amountMismatch.length}`);
    } else {
      this.logger.log(`支付对账通过 ${day}: ${local.length} 笔一致`);
    }
    return report;
  }

  /** 微信交易账单行解析（CSV，容忍表头/空行/引号）：取单号列与总金额列（元→分） */
  private parseBillLine(line: string): { outTradeNo: string; amountCent: number } | null {
    if (!line || line.startsWith('#')) return null;
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const outTradeNo = cols.find((c) => /^QJ\d+$/.test(c));
    if (!outTradeNo) return null;
    // 金额列取最后一个可解析为数字的字段（账单以元为单位）
    const amountRaw = [...cols].reverse().find((c) => /^-?\d+(\.\d+)?$/.test(c));
    const amountCent = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : 0;
    return { outTradeNo, amountCent };
  }

  private yesterdayYmd(): string {
    const d = new Date(Date.now() - 864e5);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  private genOutTradeNo(): string {
    return `QJ${Date.now()}${randomInt(1000, 10000)}`;
  }

  /**
   * 我的优惠券（§5.11，Step 15）：面额 + 过期倒计时（expireInMs，倒计时组件数据源）。
   * 读取时兜底：UNUSED 但已过 expireAt 的按 EXPIRED 展示（与额度 §6.4 同语义，不待清扫）。
   */
  async listMyCoupons(userId: bigint, status?: UserCouponStatus) {
    if (status && !['UNUSED', 'USED', 'EXPIRED'].includes(status)) {
      throw new BadRequestException('status 仅支持 UNUSED/USED/EXPIRED');
    }
    const rows = await this.prisma.userCoupon.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: { template: true },
      orderBy: [{ expireAt: 'asc' }, { id: 'desc' }],
    });
    const now = Date.now();
    return rows.map((c) => {
      const expired = c.status === UserCouponStatus.UNUSED && c.expireAt.getTime() <= now;
      const effStatus = expired ? UserCouponStatus.EXPIRED : c.status;
      return {
        id: c.id.toString(),
        name: c.template.name,
        scope: c.template.scope,
        amountCent: c.template.amountCent,
        minAmountCent: c.template.minAmountCent,
        status: effStatus,
        expireAt: c.expireAt.toISOString(),
        expireInMs: Math.max(0, c.expireAt.getTime() - now),
      };
    });
  }
}
