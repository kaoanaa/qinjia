import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AdminRole, CouponScope } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { OrderService } from '../src/modules/order/order.service';

/**
 * Step 17（§5.12/D6 加速脱单管家 + §6.5/D7 退款工单流）。真实 MySQL，禁 mock 库。
 * 覆盖验收用例 7：退款公式三边界（0 消耗全退 / 部分消耗折抵 / 末 30 天拒退）+ 0 元不退 +
 * 单次解锁四分支（已联系不退 / 违规下架全退返额度 / 过期不退 / 自动退款旁路）+ 状态机守卫 +
 * 管家留资→派单（IM 联动）→结案全链。红线：窗口参数读 refund_rules（I1），金额判定只在服务端（I3）。
 */
describe('加速脱单管家与退款工单流 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orderSvc: OrderService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tokens: Record<string, string> = {};
  let managerId: bigint;
  let phoneSeq = 0;
  let profileSeq = 0;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(server()).post('/api/v1/auth/login').send({ code: `W17_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_W17_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } }); // 隔离注册赠礼额度
    return { id: user.id, token: login.body.token };
  }

  async function realnameDb(userId: bigint) {
    phoneSeq += 1;
    const digits = String((Number(suffix) + phoneSeq * 7919) % 100000000).padStart(8, '0'); // 11 位手机号形态，掩码断言用
    await prisma.user.update({ where: { id: userId }, data: { idCardNoHash: `w17hash_${suffix}_${phoneSeq}`, phone: `139${digits}` } });
  }

  async function makeProfile(ownerUserId: bigint, gender: 'MALE' | 'FEMALE' = 'FEMALE') {
    profileSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `W17MN${suffix}_${profileSeq}`, ownerUserId, isActive: true,
        relation: 'MOTHER', gender, birthYear: 1995, heightCm: 165,
        education: 'BACHELOR', occupation: '设计师', residenceCity: '杭州',
        intro: '退款测试目标', photos: [], isMaritalVerified: true, auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
  }

  /** 解锁者+目标配对（均实名建档），返回 token/userId/目标档案 */
  async function pair(tag: string) {
    const u = await newUser(tag);
    await realnameDb(u.id);
    await makeProfile(u.id, 'MALE');
    const t = await newUser(`${tag}_t`);
    await realnameDb(t.id);
    const tp = await makeProfile(t.id, 'FEMALE');
    return { u, tp };
  }

  async function payCallback(outTradeNo: string, txn: string) {
    return request(server()).post('/api/v1/orders/callback/wxpay').send({ outTradeNo, transactionId: txn }).expect(200);
  }

  /** 购会员并支付，返回订单行 */
  async function buyMember(userId: bigint, token: string, planId: 'month' | 'year', txn: string) {
    const res = await request(server()).post('/api/v1/orders').set(auth(token)).send({ type: 'MEMBER', planId }).expect(201);
    await payCallback(res.body.outTradeNo, txn);
    return prisma.order.findUniqueOrThrow({ where: { id: BigInt(res.body.orderId) } });
  }

  /** 付费单次解锁（ONCE 1990），返回 {order, rec} */
  async function paidOnceUnlock(u: { id: bigint; token: string }, targetProfileId: bigint, ik: string) {
    const res = await request(server())
      .post('/api/v1/orders').set(auth(u.token)).send({ type: 'UNLOCK_ONCE', targetProfileId: targetProfileId.toString() })
      .expect(201);
    await payCallback(res.body.outTradeNo, `TXN_${ik}_${suffix}`);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(res.body.orderId) } });
    const rec = await prisma.unlockRecord.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, rec };
  }

  async function giveCoupon(userId: bigint, scope: CouponScope, amountCent: number, orderId: bigint | null = null) {
    const tpl = await prisma.couponTemplate.create({
      data: { name: `w17t_${suffix}_${++profileSeq}`, scope, amountCent, minAmountCent: 0, validDays: 30, startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 30 * 864e5) },
    });
    return prisma.userCoupon.create({ data: { templateId: tpl.id, userId, orderId, expireAt: new Date(Date.now() + 30 * 864e5), source: 'test' } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'admin/(.*)', method: RequestMethod.ALL }] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0); // 常驻监听，规避 macOS 端口复用竞态
    prisma = app.get(PrismaService);
    orderSvc = app.get(OrderService);

    // §11 配置键兜底（值与 seed 一致；refund_rules 强制写入，红线 I1）
    const refundRules = { memberRefundWindowDays: 7, noRefundLastDays: 30, unlockViolationRefundWindowHours: 24 };
    await prisma.rewardConfig.upsert({ where: { configKey: 'refund_rules' }, update: { value: refundRules }, create: { configKey: 'refund_rules', value: refundRules, updatedBy: 'test' } });
    await prisma.rewardConfig.upsert({ where: { configKey: 'ticket_sla' }, update: {}, create: { configKey: 'ticket_sla', value: { firstResponseHours: 48 }, updatedBy: 'test' } });
    const copyRow = await prisma.rewardConfig.findUnique({ where: { configKey: 'copywriting' } });
    const copyVal = (copyRow?.value ?? {}) as Record<string, unknown>;
    const copyDefaults = {
      managerAssigned: { title: '专属管家已上线', body: '您的加速脱单需求已受理，管家将通过站内消息与您 1v1 沟通，请留意消息提醒' },
      managerWelcomeTip: '您好，我是您的专属脱单管家，已收到您的服务需求，接下来由我为您提供 1v1 介绍服务',
      refundRulesTip: '退款将按平台规则核算，原路退回预计 3-7 个工作日到账',
    };
    if (!copyRow) {
      await prisma.rewardConfig.create({ data: { configKey: 'copywriting', value: copyDefaults, updatedBy: 'test' } });
    } else if (!copyVal.managerWelcomeTip || !copyVal.refundRulesTip || !copyVal.managerAssigned) {
      await prisma.rewardConfig.update({ where: { configKey: 'copywriting' }, data: { value: { ...copyDefaults, ...copyVal } } });
    }

    for (const [username, role] of [['w17_super', AdminRole.SUPER], ['w17_finance', AdminRole.FINANCE], ['w17_operator', AdminRole.OPERATOR], ['w17_reviewer', AdminRole.REVIEWER]] as [string, AdminRole][]) {
      await prisma.adminUser.upsert({ where: { username }, update: { role, enabled: true }, create: { username, passwordHash: bcrypt.hashSync('pw123456', 10), role } });
    }
    for (const k of ['super', 'finance', 'operator', 'reviewer']) {
      const r = await request(server()).post('/admin/v1/auth/login').send({ username: `w17_${k}`, password: 'pw123456' }).expect(200);
      tokens[k] = r.body.token;
    }
    const mgr = await prisma.adminUser.findUniqueOrThrow({ where: { username: 'w17_operator' } });
    managerId = mgr.id;
  });

  afterAll(async () => {
    // 自清理：停用本套件档案与留资，避免污染全局候选池/留资列表断言
    const owners = await prisma.user.findMany({ where: { openid: { startsWith: `mock_openid_W17_` } }, select: { id: true } });
    const ids = owners.map((u) => u.id);
    await prisma.profile.updateMany({ where: { ownerUserId: { in: ids } }, data: { isActive: false } });
    await prisma.managerLead.deleteMany({ where: { userId: { in: ids } } });
    await app.close();
  });

  // ==================== 用例 7 边界一：7 天内 0 消耗 → 全额退（含反履约） ====================
  it('用例7-1：月卡 0 消耗申请→试算 9900 全退；FINANCE 核准→REFUNDED、批次清零(EXPIRED+ZERO_OUT)、到期回滚、工单关闭、系统消息', async () => {
    const u = await newUser('rf_full');
    const expireBefore = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).memberExpireAt; // TRIAL 到期时间
    const order = await buyMember(u.id, u.token, 'month', `TXN_full_${suffix}`);
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { orderId: order.id } });
    expect(batch.remaining).toBe(30);

    const req = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '误操作购买' }).expect(201);
    expect(req.body.estimatedRefundCent).toBe(9900);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { userId: u.id, type: 'REFUND' } });
    expect(ticket.status).toBe('OPEN');
    expect(ticket.content).toContain(`订单 ${order.id}`);

    const ok = await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.finance)).send({ approved: true }).expect(200);
    expect(ok.body).toMatchObject({ refundStatus: 'REFUNDED', refundAmountCent: 9900, quotaReturned: false });
    expect(ok.body.rule).toBe('FULL_ZERO_CONSUME');

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.refundNo).toContain('mock_refund_');
    const gone = await prisma.memberQuota.findUniqueOrThrow({ where: { id: batch.id } });
    expect(gone).toMatchObject({ remaining: 0, status: 'EXPIRED' });
    expect(await prisma.quotaTxLog.count({ where: { userId: u.id, reason: 'ZERO_OUT', refId: order.id } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(Math.abs(user.memberExpireAt!.getTime() - expireBefore!.getTime())).toBeLessThan(60_000); // 精确扣回 30d，保留购前 TRIAL 期
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }).then((t) => t.status)).toBe('CLOSED');
    const notices = await request(server()).get('/api/v1/notifications').set(auth(u.token)).expect(200);
    expect(notices.body.items.some((n: { title: string }) => n.title === '退款裁决结果')).toBe(true);
    expect(notices.body.items.some((n: { body: string }) => n.body.includes('3-7 个工作日'))).toBe(true); // refundRulesTip 读配置
  });

  // ==================== 用例 7 边界二：部分消耗折抵 ====================
  it('用例7-2：年卡已耗 2 次+期内发券 500 → 79900-2×1990-500=75420；审核员 403、状态机守卫 400', async () => {
    const u = await newUser('rf_partial');
    const order = await buyMember(u.id, u.token, 'year', `TXN_part_${suffix}`);
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.memberQuota.update({ where: { id: batch.id }, data: { used: 2, remaining: batch.total - 2 } });
    await giveCoupon(u.id, CouponScope.MEMBER, 500); // orderId=null 视为期内派发，计入折抵

    await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.finance)).send({ approved: true }).expect(400); // 未经申请直接裁决 → 状态非法
    await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.reviewer)).send({ approved: true }).expect(403); // 角色门槛

    const req = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '服务不满意' }).expect(201);
    expect(req.body.estimatedRefundCent).toBe(75420);
    const ok = await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.finance)).send({ approved: true, reason: '核算通过' }).expect(200);
    expect(ok.body).toMatchObject({ refundStatus: 'REFUNDED', refundAmountCent: 75420 });
    expect(ok.body.rule).toBe('PARTIAL_CONSUME_DEDUCT');
    expect(ok.body.calcDetail).toMatchObject({ consumedCount: 2, oncePriceCent: 1990, issuedCouponCent: 500 });
  });

  // ==================== 用例 7 边界三：末 30 天拒退 + 0 元不退 + 重复/越权守卫 ====================
  it('用例7-3：临期 30 天内拒退 400；0 元券购卡不退；重复申请 409；他人订单 404', async () => {
    const u = await newUser('rf_last');
    const order = await buyMember(u.id, u.token, 'month', `TXN_last_${suffix}`);
    // 已消耗 + 模拟会员期已进行 29 天（距到期 ≤30 天）→ 末段拒退优先于部分折抵
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.memberQuota.update({ where: { id: batch.id }, data: { used: 1, remaining: batch.total - 1 } });
    await prisma.order.update({ where: { id: order.id }, data: { paidAt: new Date(Date.now() - 29 * 864e5) } });
    const rej = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '想退款' }).expect(400);
    expect(rej.body.errorCode).toBe('REFUND_NOT_ELIGIBLE');
    expect(rej.body.message).toContain('30');

    const req = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '再次尝试' }).expect(400); // 从未进入 REQUESTED，仍是不可退而非 409
    expect(req.body.errorCode).toBe('REFUND_NOT_ELIGIBLE');

    // 0 元（券全额抵扣）购卡：即时履约，申请退款 → 不退
    const u2 = await newUser('rf_zero');
    const freeCoupon = await giveCoupon(u2.id, CouponScope.MEMBER, 9900);
    const zOrder = await request(server()).post('/api/v1/orders').set(auth(u2.token)).send({ type: 'MEMBER', planId: 'month', userCouponId: freeCoupon.id.toString() }).expect(201);
    expect(zOrder.body.amountCent).toBe(0);
    const zr = await request(server()).post(`/api/v1/orders/${zOrder.body.orderId}/refund-request`).set(auth(u2.token)).send({ reason: '0元也要退' }).expect(400);
    expect(zr.body.message).toContain('0 元');

    // 重复申请 409 + 他人订单 404
    const u3 = await newUser('rf_dup');
    const o3 = await buyMember(u3.id, u3.token, 'month', `TXN_dup_${suffix}`);
    await request(server()).post(`/api/v1/orders/${o3.id}/refund-request`).set(auth(u3.token)).send({ reason: '首提' }).expect(201);
    const dup = await request(server()).post(`/api/v1/orders/${o3.id}/refund-request`).set(auth(u3.token)).send({ reason: '重提' }).expect(409);
    expect(dup.body.errorCode).toBe('REFUND_ALREADY_REQUESTED');
    const other = await newUser('rf_oth');
    await request(server()).post(`/api/v1/orders/${o3.id}/refund-request`).set(auth(other.token)).send({ reason: '别人的单' }).expect(404);
    await request(server()).post(`/api/v1/orders/${o3.id}/refund-request`).set(auth(u3.token)).send({ reason: '短' }).expect(400); // MinLength 2
  });

  // ==================== 驳回链路 ====================
  it('客服驳回 → REJECTED、工单关闭、消息通知；驳回后不可重复申请', async () => {
    const u = await newUser('rf_reject');
    const order = await buyMember(u.id, u.token, 'month', `TXN_rej_${suffix}`);
    await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '试试看' }).expect(201);
    const res = await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.finance)).send({ approved: false, reason: '超过无理由退款期' }).expect(200);
    expect(res.body.refundStatus).toBe('REJECTED');
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.refundReason).toBe('超过无理由退款期');
    expect(await prisma.ticket.findFirstOrThrow({ where: { userId: u.id, type: 'REFUND' } }).then((t) => t.status)).toBe('CLOSED');
    const notices = await request(server()).get('/api/v1/notifications').set(auth(u.token)).expect(200);
    expect(notices.body.items.some((n: { title: string }) => n.title === '退款申请已驳回')).toBe(true);
    // REQUESTED 已消失，再申请因 refundStatus≠NONE 被拒
    await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '再试一次' }).expect(409);
  });

  // ==================== 单次解锁退款四分支 ====================
  it('已交换微信/已拨电话 → 不退', async () => {
    const { u, tp } = await pair('uc_contact');
    const { order, rec } = await paidOnceUnlock(u, tp.id, 'uc1');
    const conv = await prisma.conversation.findFirstOrThrow({ where: { unlockRecordId: rec.id } });
    await prisma.contactActionLog.create({ data: { convId: conv.id, actorUserId: u.id, action: 'EXCHANGE_WECHAT' } });
    const res = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '想退解锁费' }).expect(400);
    expect(res.body.message).toContain('已交换微信');
  });

  it('过期解锁 → 不退', async () => {
    const { u, tp } = await pair('uc_expired');
    const { order, rec } = await paidOnceUnlock(u, tp.id, 'uc2');
    await prisma.unlockRecord.update({ where: { id: rec.id }, data: { status: 'EXPIRED', expireAt: new Date(Date.now() - 1000) } });
    const res = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '过期想退' }).expect(400);
    expect(res.body.message).toContain('过期');
  });

  it('对方违规下架（24h 窗口内）→ 全退 1990 + 返额度；工单+反履约留痕', async () => {
    const { u, tp } = await pair('uc_viol');
    const { order, rec } = await paidOnceUnlock(u, tp.id, 'uc3');
    await prisma.profile.update({ where: { id: tp.id }, data: { auditStatus: 'REJECTED', isActive: false } }); // 模拟后台下架（updatedAt=now 落窗口内）

    const req = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '对方资料违规' }).expect(201);
    expect(req.body.estimatedRefundCent).toBe(1990);

    const ok = await request(server()).post(`/admin/v1/orders/${order.id}/refund`).set(auth(tokens.finance)).send({ approved: true }).expect(200);
    expect(ok.body).toMatchObject({ refundStatus: 'REFUNDED', refundAmountCent: 1990, quotaReturned: true });
    expect((await prisma.unlockRecord.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('REFUNDED');
    const back = await prisma.memberQuota.findFirstOrThrow({ where: { orderId: order.id, source: 'PAID' } });
    expect(back).toMatchObject({ total: 1, remaining: 1, status: 'ACTIVE' }); // 返还 1 次额度
  });

  it('auditProfile REJECT 自动退款旁路：付费单次解锁违规下架 → 自动全退+返额度（§6.5-2）', async () => {
    const { u, tp } = await pair('uc_auto');
    const { order, rec } = await paidOnceUnlock(u, tp.id, 'uc4');
    await prisma.profile.update({ where: { id: tp.id }, data: { auditStatus: 'REJECTED', isActive: false } });

    const res = await orderSvc.autoRefundViolationUnlock(order.id);
    expect(res).toMatchObject({ refundStatus: 'REFUNDED', refundAmountCent: 1990, quotaReturned: true });
    expect((await prisma.unlockRecord.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('REFUNDED');
    // 幂等：已退订单再次触发直接跳过
    expect(await orderSvc.autoRefundViolationUnlock(order.id)).toBeNull();
    // 未命中违规窗口（正常在线）→ 不自动退
    const p2 = await pair('uc_auto2');
    const r2 = await paidOnceUnlock(p2.u, p2.tp.id, 'uc5');
    expect(await orderSvc.autoRefundViolationUnlock(r2.order.id)).toBeNull();
  });

  it('非违规拒绝的普通解锁订单：NOT_REFUNDABLE 拒退', async () => {
    const { u, tp } = await pair('uc_normal');
    const { order } = await paidOnceUnlock(u, tp.id, 'uc6');
    const res = await request(server()).post(`/api/v1/orders/${order.id}/refund-request`).set(auth(u.token)).send({ reason: '就是不想解锁了' }).expect(400);
    expect(res.body.message).toContain('24h');
  });

  // ==================== 管家留资与派单（§5.12/D6） ====================
  it('留资→后台列表→派单（ASSIGNED+convId+消息）→FOLLOWING→DONE→结案守卫', async () => {
    const u = await newUser('mgr_u');
    await realnameDb(u.id);

    await request(server()).post('/api/v1/manager-leads').send({ city: '杭州', expectation: '希望尽快脱单' }).expect(401); // 未登录
    const bad = await request(server()).post('/api/v1/manager-leads').set(auth(u.token)).send({ city: '', expectation: 'x' }).expect(400); // 必填校验
    void bad;

    const lead = await request(server()).post('/api/v1/manager-leads').set(auth(u.token)).send({ city: '杭州', expectation: '希望 1 个月内安排 3 次见面', budgetCent: 20000 }).expect(201);
    expect(lead.body.status).toBe('NEW');
    // 重复留资 → 更新同一条（userId 唯一）
    const again = await request(server()).post('/api/v1/manager-leads').set(auth(u.token)).send({ city: '宁波', expectation: '改主意了，换个城市' }).expect(201);
    expect(again.body.leadId).toBe(lead.body.leadId);

    const list = await request(server()).get('/admin/v1/manager-leads').query({ status: 'NEW' }).set(auth(tokens.operator)).expect(200);
    const row = list.body.items.find((i: { id: string }) => i.id === lead.body.leadId);
    expect(row).toMatchObject({ city: '宁波', status: 'NEW' });
    expect(row.phoneMasked).toMatch(/^139\*{4}\d{4}$/);
    await request(server()).get('/admin/v1/manager-leads').query({ status: 'BOGUS' }).set(auth(tokens.operator)).expect(400);
    await request(server()).get('/admin/v1/manager-leads').set(auth(tokens.finance)).expect(403); // 仅 SUPER/OPERATOR

    const conv = await request(server()).post(`/admin/v1/manager-leads/${lead.body.leadId}/assign`).set(auth(tokens.operator)).send({ managerId: managerId.toString() }).expect(200);
    expect(conv.body.status).toBe('ASSIGNED');
    expect(conv.body.convId).toBe(`manager_${managerId}_${u.id}`);
    const assigned = await prisma.managerLead.findUniqueOrThrow({ where: { id: BigInt(lead.body.leadId) } });
    expect(assigned.assignedManagerId).toBe(managerId);
    const notices = await request(server()).get('/api/v1/notifications').set(auth(u.token)).expect(200);
    expect(notices.body.items.some((n: { title: string }) => n.title === '专属管家已上线')).toBe(true); // copywriting.managerAssigned

    await request(server()).post(`/admin/v1/manager-leads/${lead.body.leadId}/assign`).set(auth(tokens.operator)).send({ managerId: '999999999' }).expect(400); // 管家不存在
    await request(server()).post(`/admin/v1/manager-leads/999999999/assign`).set(auth(tokens.operator)).send({ managerId: managerId.toString() }).expect(404);
    await request(server()).post(`/admin/v1/manager-leads/${lead.body.leadId}/assign`).set(auth(tokens.operator)).send({ managerId: 'not-a-number' }).expect(400);

    await request(server()).put(`/admin/v1/manager-leads/${lead.body.leadId}/status`).set(auth(tokens.operator)).send({ status: 'FOLLOWING' }).expect(200);
    const done = await request(server()).put(`/admin/v1/manager-leads/${lead.body.leadId}/status`).set(auth(tokens.operator)).send({ status: 'DONE' }).expect(200);
    expect(done.body.status).toBe('DONE');
    await request(server()).put(`/admin/v1/manager-leads/${lead.body.leadId}/status`).set(auth(tokens.operator)).send({ status: 'NEW' }).expect(400); // 只允许 FOLLOWING/DONE
    await request(server()).post(`/admin/v1/manager-leads/${lead.body.leadId}/assign`).set(auth(tokens.operator)).send({ managerId: managerId.toString() }).expect(409); // 结案后禁重派
    const closed = await request(server()).post('/api/v1/manager-leads').set(auth(u.token)).send({ city: '杭州', expectation: '再买一次服务' }).expect(400); // 结案后禁再留资
    expect(closed.body.errorCode).toBe('LEAD_DONE');
  });
});
