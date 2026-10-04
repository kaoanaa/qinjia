import {
  BadRequestException,
  forwardRef,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContactAction, CouponScope, Order, OrderType, PayStatus, Prisma, QuotaSource, QuotaStatus, QuotaTxReason, RefundStatus, TicketType, UnlockPayType, UnlockStatus, UserCouponStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, SMS, SmsProvider, WX_PAY, WxPay } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { decryptField } from '../../common/crypto';
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

/** §6.5 退款试算结果（公式逐项留痕，用例 7 断言数据源） */
export interface RefundEstimate {
  refundAmountCent: number;
  quotaReturned: boolean;
  rule: 'FREE_NO_REFUND' | 'FULL_ZERO_CONSUME' | 'PARTIAL_CONSUME_DEDUCT' | 'LAST_DAYS_NO_REFUND' | 'VIOLATION_FULL_REFUND' | 'CONTACT_NO_REFUND' | 'EXPIRED_NO_REFUND' | 'NOT_REFUNDABLE' | 'NO_UNLOCK';
  calcDetail: Record<string, unknown>;
  rejectReason?: string;
}

interface RefundRulesCfg {
  memberRefundWindowDays: number;
  noRefundLastDays: number;
  unlockViolationRefundWindowHours: number;
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
    @Inject(SMS) private readonly sms: SmsProvider,
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
    if (fulfilled) await this.notifyChildOnBigPay(order.userId, order.amountCent);
    return { handled: true, idempotent: !fulfilled };
  }

  /**
   * 子女协助管理（§5.8/老年人保护，Step 16）：开启后单笔 ≥ big_pay_threshold（分，读配置 I1）
   * 短信通知子女手机（consent_record 解密，I5）。旁路：失败不阻断履约。
   */
  private async notifyChildOnBigPay(userId: bigint, amountCent: number) {
    try {
      const [user, cfg] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { bigPayNotifyChild: true } }),
        this.config.get<{ amountCent: number }>(ConfigKeys.BIG_PAY_THRESHOLD),
      ]);
      if (!user?.bigPayNotifyChild || amountCent < cfg.amountCent) return;
      const profiles = await this.prisma.profile.findMany({ where: { ownerUserId: userId }, select: { id: true } });
      const consents = await this.prisma.consentRecord.findMany({ where: { profileId: { in: profiles.map((p) => p.id) } } });
      for (const c of consents) {
        try {
          await this.sms.sendCode(decryptField(c.childPhone), 'big_pay_confirm');
        } catch (e) {
          this.logger.warn(`大额支付子女通知失败 consentId=${c.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`大额支付子女通知异常: ${(e as Error).message}`);
    }
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
      const zeroOrderId = await this.prisma.$transaction(async (tx) => {
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
        return order.id;
      });
      return { orderId: zeroOrderId.toString(), outTradeNo, amountCent: 0, couponDeductCent: deduct, confirmRequired: false, paySignParams: {} };
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

  // ==================== 退款（D7/§6.5，Step 17） ====================

  /**
   * §6.5 公式试算（服务端唯一裁决源，红线 I3 精神：金额判定只在服务端）：
   * 会员：窗口内 0 消耗全退；已消耗=实付−消耗次数×单次挂牌价−期内已发券面额（下限 0）；期末 N 天不退；0 元赠送不退。
   * 单次解锁：仅 24h（配置）内对方违规下架/举报属实 → 全退+返额度；已交换微信/已拨电话不退；过期不退。
   */
  async estimateRefund(order: Order): Promise<RefundEstimate> {
    const cfg = await this.config.get<RefundRulesCfg>(ConfigKeys.REFUND_RULES);
    const paidActual = order.amountCent - order.couponDeductCent;
    const base: Record<string, unknown> = { orderType: order.type, listPriceCent: order.amountCent, couponDeductCent: order.couponDeductCent, actualPaidCent: paidActual };
    if (paidActual <= 0) return { refundAmountCent: 0, quotaReturned: false, rule: 'FREE_NO_REFUND', calcDetail: base, rejectReason: '0 元/赠送权益不涉及退款' };

    if (order.type === OrderType.MEMBER) {
      const plan = await this.memberPlan(order.bizRef ?? '');
      const agg = await this.prisma.memberQuota.aggregate({ where: { orderId: order.id }, _sum: { used: true } });
      const consumedCount = agg._sum.used ?? 0;
      // 期内已发券面额：本订单会员期内派发的权益券（续费/邀请等，source 非本单抵扣券；本单抵扣已体现在实付）
      const issued = await this.prisma.userCoupon.findMany({
        where: { userId: order.userId, orderId: null, createdAt: { gte: order.paidAt ?? order.createdAt } },
        include: { template: true },
      });
      const issuedCouponCent = issued.reduce((s, c) => s + c.template.amountCent, 0);
      const paidAt = (order.paidAt ?? order.createdAt).getTime();
      const expireAt = paidAt + plan.days * 864e5;
      const now = Date.now();
      const inWindow = now - paidAt <= cfg.memberRefundWindowDays * 864e5;
      const lastDaysBlocked = expireAt - now <= cfg.noRefundLastDays * 864e5;
      const calc = { ...base, planDays: plan.days, consumedCount, issuedCouponCent, inWindow, lastDaysBlocked, windowDays: cfg.memberRefundWindowDays, noRefundLastDays: cfg.noRefundLastDays };
      // 优先级：7天内0消耗全退 > 末30天拒退 > 部分消耗折抵（否则30天套餐购买当天即被"末30天"误拦）
      if (inWindow && consumedCount === 0) return { refundAmountCent: paidActual, quotaReturned: false, rule: 'FULL_ZERO_CONSUME', calcDetail: calc };
      if (lastDaysBlocked) return { refundAmountCent: 0, quotaReturned: false, rule: 'LAST_DAYS_NO_REFUND', calcDetail: calc, rejectReason: `会员期最后 ${cfg.noRefundLastDays} 天不退（法定除外）` };
      const oncePrice = await this.oncePriceCent();
      const amount = Math.max(0, paidActual - consumedCount * oncePrice - issuedCouponCent);
      return {
        refundAmountCent: amount, quotaReturned: false, rule: 'PARTIAL_CONSUME_DEDUCT',
        calcDetail: { ...calc, oncePriceCent: oncePrice, deductedCent: consumedCount * oncePrice + issuedCouponCent },
        ...(amount === 0 ? { rejectReason: '已消耗折抵后无可退金额' } : {}),
      };
    }

    const rec = await this.prisma.unlockRecord.findFirst({ where: { orderId: order.id } });
    if (!rec) return { refundAmountCent: 0, quotaReturned: false, rule: 'NO_UNLOCK', calcDetail: base, rejectReason: '未找到解锁记录' };
    const conv = await this.prisma.conversation.findFirst({ where: { unlockRecordId: rec.id }, select: { id: true } });
    const contact = conv
      ? await this.prisma.contactActionLog.findFirst({ where: { convId: conv.id, action: { in: [ContactAction.EXCHANGE_WECHAT, ContactAction.CALL_PHONE] } }, select: { action: true } })
      : null;
    if (contact) return { refundAmountCent: 0, quotaReturned: false, rule: 'CONTACT_NO_REFUND', calcDetail: { ...base, contactAction: contact.action }, rejectReason: '已交换微信或已拨打电话不退' };
    if (rec.status === UnlockStatus.EXPIRED || rec.expireAt.getTime() <= Date.now()) {
      return { refundAmountCent: 0, quotaReturned: false, rule: 'EXPIRED_NO_REFUND', calcDetail: base, rejectReason: '过期解锁不退' };
    }
    const target = await this.prisma.profile.findUniqueOrThrow({ where: { id: rec.targetProfileId }, select: { auditStatus: true, isActive: true, updatedAt: true } });
    const removedForViolation = target.auditStatus !== 'APPROVED' || !target.isActive;
    // 「24h 内对方违规下架」：下架动作发生在解锁后 window 小时内
    const withinWindow = removedForViolation && target.updatedAt.getTime() >= rec.createdAt.getTime()
      ? target.updatedAt.getTime() - rec.createdAt.getTime() <= cfg.unlockViolationRefundWindowHours * 36e5
      : false;
    if (removedForViolation && withinWindow) {
      return { refundAmountCent: paidActual, quotaReturned: true, rule: 'VIOLATION_FULL_REFUND', calcDetail: { ...base, removedForViolation, withinWindow, windowHours: cfg.unlockViolationRefundWindowHours } };
    }
    return {
      refundAmountCent: 0, quotaReturned: false, rule: 'NOT_REFUNDABLE',
      calcDetail: { ...base, removedForViolation, withinWindow },
      rejectReason: `单次解锁仅对方违规下架 ${cfg.unlockViolationRefundWindowHours}h 内可全退`,
    };
  }

  /** 用户发起退款申请（POST /orders/:id/refund-request）：可退性服务端把关 → REQUESTED + REFUND 工单（SLA 读配置） */
  async requestRefund(userId: bigint, orderId: bigint, reason: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('订单不存在');
    if (order.payStatus !== PayStatus.PAID) throw new BusinessException(HttpStatus.BAD_REQUEST, 'ORDER_NOT_PAID', '仅已支付订单可申请退款');
    if (order.refundStatus !== RefundStatus.NONE) {
      throw new BusinessException(HttpStatus.CONFLICT, 'REFUND_ALREADY_REQUESTED', `订单退款状态为 ${order.refundStatus}，勿重复提交`);
    }
    const est = await this.estimateRefund(order);
    if (est.refundAmountCent <= 0) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, 'REFUND_NOT_ELIGIBLE', est.rejectReason ?? '该订单不符合退款规则');
    }
    const sla = await this.config.get<{ firstResponseHours: number }>(ConfigKeys.TICKET_SLA);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const gate = await tx.order.updateMany({ where: { id: order.id, refundStatus: RefundStatus.NONE }, data: { refundStatus: RefundStatus.REQUESTED, refundReason: reason } });
      if (gate.count !== 1) throw new BusinessException(HttpStatus.CONFLICT, 'REFUND_ALREADY_REQUESTED', '勿重复提交退款申请');
      return tx.ticket.create({
        data: { userId, type: TicketType.REFUND, content: `退款申请｜订单 ${order.id}｜原因：${reason}`, status: 'OPEN', slaDeadline: new Date(Date.now() + sla.firstResponseHours * 36e5) },
      });
    });
    this.logger.log(`退款申请 order=${order.id} ticket=${ticket.id} 试算=${est.refundAmountCent}`);
    return { orderId: order.id.toString(), ticketId: ticket.id.toString(), estimatedRefundCent: est.refundAmountCent };
  }

  /** 后台裁决执行（AdminService 调）：驳回→REJECTED；核准→原路退回 + 反履约 + 关工单 + 系统消息 */
  async adjudicateRefund(orderId: bigint, approved: boolean, reason?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.refundStatus !== RefundStatus.REQUESTED) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, 'REFUND_STATE_INVALID', '订单不在待退款裁决状态');
    }
    if (!approved) {
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: RefundStatus.REJECTED, refundReason: reason ?? '客服裁决驳回' } });
      await this.closeRefundTickets(order, '退款申请已驳回', undefined);
      await this.notifyRefund(order.userId, '退款申请已驳回', reason ?? null);
      return { refundStatus: RefundStatus.REJECTED, refundAmountCent: 0, quotaReturned: false, rule: null as string | null, calcDetail: { decision: 'REJECTED', reason: reason ?? null } };
    }
    const est = await this.estimateRefund(order);
    if (est.refundAmountCent <= 0) {
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: RefundStatus.REJECTED, refundReason: est.rejectReason ?? '试算无可退金额' } });
      await this.closeRefundTickets(order, est.rejectReason ?? '试算无可退金额', undefined);
      await this.notifyRefund(order.userId, '退款申请已驳回', est.rejectReason ?? null);
      return { refundStatus: RefundStatus.REJECTED, refundAmountCent: 0, quotaReturned: false, rule: est.rule, calcDetail: est.calcDetail };
    }
    const refundNo = `RF${order.id}_${Date.now()}`;
    const res = await this.wxpay.refund({ outTradeNo: order.outTradeNo, outRefundNo: refundNo, amountCent: est.refundAmountCent, totalCent: order.amountCent - order.couponDeductCent });
    const finalStatus = res.status === 'SUCCESS' ? RefundStatus.REFUNDED : RefundStatus.REFUNDING;

    await this.prisma.$transaction(async (tx) => {
      if (order.type === OrderType.MEMBER) {
        const plan = await this.memberPlan(order.bizRef ?? '');
        const quotas = await tx.memberQuota.findMany({ where: { orderId: order.id, remaining: { gt: 0 } } });
        for (const q of quotas) {
          await tx.memberQuota.update({ where: { id: q.id }, data: { remaining: 0, status: QuotaStatus.EXPIRED } });
          await tx.quotaTxLog.create({ data: { userId: order.userId, quotaId: q.id, reason: QuotaTxReason.ZERO_OUT, change: -q.remaining, refType: 'refund', refId: order.id } });
        }
        const u = await tx.user.findUniqueOrThrow({ where: { id: order.userId }, select: { memberExpireAt: true } });
        if (u.memberExpireAt) {
          await tx.user.update({ where: { id: order.userId }, data: { memberExpireAt: new Date(Math.max(Date.now(), u.memberExpireAt.getTime() - plan.days * 864e5)) } });
        }
      } else {
        const rec = await tx.unlockRecord.findFirst({ where: { orderId: order.id, status: UnlockStatus.ACTIVE } });
        if (rec) {
          await tx.unlockRecord.update({ where: { id: rec.id }, data: { status: UnlockStatus.REFUNDED } }); // 会话发消息权限由服务端回调按解锁状态裁决（§5.6）
          if (est.quotaReturned) {
            await this.quota.grantBatch(tx, { userId: order.userId, source: QuotaSource.PAID, count: 1, days: await this.unlockDays(), orderId: order.id });
          }
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { refundStatus: finalStatus, refundNo: res.refundId, refundAmountCent: est.refundAmountCent } });
    });
    await this.closeRefundTickets(order, `退款 ${est.refundAmountCent} 分（${res.status === 'SUCCESS' ? '已退回' : '退款中'}）`, est);
    await this.notifyRefund(order.userId, '退款裁决结果', reason ?? null);
    this.logger.log(`退款裁决 order=${order.id} amount=${est.refundAmountCent} status=${finalStatus} rule=${est.rule}`);
    return { refundStatus: finalStatus, refundAmountCent: est.refundAmountCent, quotaReturned: est.quotaReturned, rule: est.rule, calcDetail: est.calcDetail };
  }

  /** 违规下架自动退款（§6.5-2，auditProfile REJECT 旁路调用）：付费单次解锁在窗口内 → 直接按规则全退+返额度 */
  async autoRefundViolationUnlock(orderId: bigint) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.type !== OrderType.UNLOCK_ONCE || order.refundStatus !== RefundStatus.NONE) return null;
    const est = await this.estimateRefund(order);
    if (est.rule !== 'VIOLATION_FULL_REFUND') return null;
    await this.prisma.order.update({ where: { id: order.id }, data: { refundStatus: RefundStatus.REQUESTED, refundReason: '对方违规下架自动退款' } });
    return this.adjudicateRefund(order.id, true, '对方违规下架，系统自动全额退款并返还额度');
  }

  private async closeRefundTickets(order: Order, note: string, _est?: RefundEstimate) {
    await this.prisma.ticket.updateMany({
      where: { userId: order.userId, type: TicketType.REFUND, status: { not: 'CLOSED' }, content: { contains: `订单 ${order.id}` } },
      data: { status: 'CLOSED', handlerNote: note },
    });
  }

  private async notifyRefund(userId: bigint, title: string, detail: string | null) {
    const copy = await this.config.get<{ refundRulesTip?: string }>(ConfigKeys.COPYWRITING);
    const body = [detail, copy?.refundRulesTip].filter(Boolean).join('；');
    if (!body) return;
    await this.prisma.systemNotification.create({ data: { userId, category: 'reward', title, body } });
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
