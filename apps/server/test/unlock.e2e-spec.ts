import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CouponScope, QuotaSource, UnlockStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { UnlockService } from '../src/modules/unlock/unlock.service';

/**
 * Step 8 解锁状态机 + 支付（PRD §6.1/§6.3/§5.9，红线 I2/I3/I5）。真实 MySQL，禁 mock 库。
 * 覆盖验收用例：1（无额度→单次付费）、2（被动方双向生效不扣费）、3（过期清扫/重解锁/会话保留）、
 * 6（有效期内重复解锁不扣）、13（风险确认门闸先于扣费）+ 幂等/券/会员/Refunded/状态机四态。
 */
describe('解锁状态机与支付 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let unlockSvc: UnlockService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const ONCE_PRICE = 1990; // mock 配置 unlock_once_price.amountCent
  let phoneSeq = 0;
  let profileSeq = 0;

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `U_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_U_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } }); // 隔离注册赠礼
    return { id: user.id, token: login.body.token };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function realname(userId: bigint, tag: string) {
    phoneSeq += 1;
    await prisma.user.update({
      where: { id: userId },
      data: { idCardNoHash: `mock_hash_${tag}_${suffix}`, phone: `139${suffix}${phoneSeq}` },
    });
  }

  async function makeProfile(ownerUserId: bigint, verified: boolean, isActive = true) {
    profileSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `MN${suffix}_${profileSeq}`, ownerUserId, isActive,
        relation: 'MOTHER', gender: 'FEMALE', birthYear: 1995, heightCm: 165,
        education: 'BACHELOR', occupation: '设计师', residenceCity: '杭州', photos: [],
        isMaritalVerified: verified, auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
  }

  async function grantQuota(userId: bigint, remaining: number) {
    return prisma.memberQuota.create({
      data: { userId, source: QuotaSource.PAID, total: remaining, remaining, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });
  }

  async function giveCoupon(userId: bigint, scope: CouponScope, amountCent: number, minAmountCent = 0) {
    const tpl = await prisma.couponTemplate.create({
      data: { name: `t_${suffix}`, scope, amountCent, minAmountCent, validDays: 30, startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 30 * 864e5) },
    });
    return prisma.userCoupon.create({ data: { templateId: tpl.id, userId, expireAt: new Date(Date.now() + 30 * 864e5), source: 'test' } });
  }

  /** 走真实 HTTP 回调接口（MockWxPay 解析 mock 明文报文） */
  async function payCallback(outTradeNo: string, transactionId: string) {
    return request(app.getHttpServer()).post('/api/v1/orders/callback/wxpay').send({ outTradeNo, transactionId }).expect(200);
  }

  /** 解锁者（已实名+已建档）+ 目标（已上线，verified 可控） */
  async function fixturePair(tag: string, targetVerified = true) {
    const u = await newUser(`u_${tag}`);
    await realname(u.id, `u_${tag}`);
    await makeProfile(u.id, true);
    const t = await newUser(`t_${tag}`);
    await realname(t.id, `t_${tag}`);
    const tp = await makeProfile(t.id, targetVerified);
    return { u, tp, t };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    unlockSvc = app.get(UnlockService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 用例 1：无额度 → 单次付费（HTTP 回调履约） ====================
  it('用例 1：额度为 0 → 202 need_payment ¥19.9；账本无负数；HTTP 回调后写解锁+开会话；重复回调幂等', async () => {
    const { u, tp, t } = await fixturePair('c1');
    const res = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c1_${suffix}`)
      .send({ profileId: tp.id.toString() })
      .expect(202);
    expect(res.body.state).toBe('need_payment');
    expect(res.body.order.amountCent).toBe(ONCE_PRICE);
    expect(res.body.order.paySignParams.paySign).toBe('mock');
    expect(await prisma.unlockRecord.count({ where: { initiatorUserId: u.id } })).toBe(0);

    const paid = await payCallback(res.body.order.outTradeNo, `TXN_c1_${suffix}`);
    expect(paid.body).toEqual({ code: 'SUCCESS' });

    const rec = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: u.id } });
    expect(rec).toMatchObject({ payType: 'ONCE', status: UnlockStatus.ACTIVE, riskConfirmed: false });
    const days = (rec.expireAt.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30); // 恒 created+30d（读 unlock_validity 配置）

    const conv = await prisma.conversation.findFirstOrThrow({ where: { unlockRecordId: rec.id } });
    expect(conv.userA < conv.userB).toBe(true); // 规范化排序

    // 被动方 B 无需任何操作即见联系方式（用例 2 前半）且不扣费
    const bRecs = await prisma.unlockRecord.findMany({ where: { target: { ownerUserId: t.id } } });
    expect(bRecs).toHaveLength(1);
    expect(await prisma.memberQuota.count({ where: { userId: t.id } })).toBe(0);
    const bRecords = await request(app.getHttpServer()).get('/api/v1/unlock/records').set(auth(t.token)).expect(200);
    expect(bRecords.body.items[0]).toMatchObject({ direction: 'granted_to_me', payType: 'FREE_GRANT', status: 'ACTIVE' });

    // 重复回调：幂等，不双发解锁记录
    await payCallback(res.body.order.outTradeNo, `TXN_c1b_${suffix}`);
    expect(await prisma.unlockRecord.count({ where: { initiatorUserId: u.id } })).toBe(1);
    // 扣减账本无负数
    const neg = await prisma.memberQuota.count({ where: { remaining: { lt: 0 } } });
    expect(neg).toBe(0);
  });

  // ==================== 用例 2：额度解锁 → 被动方双向生效 ====================
  it('用例 2：A 扣额度解锁 B → A 余量-1、拿到 B 手机号；B 额度不变', async () => {
    const { u, tp, t } = await fixturePair('c2');
    await grantQuota(u.id, 3);
    const bBatch = await grantQuota(t.id, 2); // B 自己的额度

    const res = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c2_${suffix}`)
      .send({ profileId: tp.id.toString() })
      .expect(200);
    expect(res.body.payType).toBe('QUOTA');
    expect(res.body.quotaRemainAfter).toBe(2);
    expect(res.body.contact.phone).toMatch(/^139/);
    expect(res.body.contact.wechat).toBeNull();
    expect(res.body.conversation.canSend).toBe(true);

    const freshB = await prisma.memberQuota.findUniqueOrThrow({ where: { id: bBatch.id } });
    expect(freshB.remaining).toBe(2); // 被动方不扣额度
  });

  // ==================== 用例 6：有效期内重复解锁不扣 ====================
  it('用例 6：active 期内重复解锁 → 复用同一记录，不扣额度不扣费；Idempotency-Key 缺失/重放', async () => {
    const { u, tp } = await fixturePair('c6');
    await grantQuota(u.id, 5);

    await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u.token)).send({ profileId: tp.id.toString() }).expect(400); // 缺 Idempotency-Key

    const first = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c6_${suffix}`)
      .send({ profileId: tp.id.toString() }).expect(200);
    // 同 key 重放 → 首次结果
    const replay = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c6_${suffix}`)
      .send({ profileId: tp.id.toString() }).expect(200);
    expect(replay.body.unlockId).toBe(first.body.unlockId);

    // 新 key：已有 active → 放行不扣（quotaRemainAfter=null 表示复用）
    const second = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c6b_${suffix}`)
      .send({ profileId: tp.id.toString() }).expect(200);
    expect(second.body.unlockId).toBe(first.body.unlockId);
    expect(second.body.quotaRemainAfter).toBeNull();

    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { userId: u.id } });
    expect(batch.remaining).toBe(4); // 仅扣 1 次
    expect(await prisma.quotaTxLog.count({ where: { userId: u.id, reason: 'DEDUCT' } })).toBe(1);
  });

  // ==================== 用例 13：未核验 → 412 风险确认先于一切扣费 ====================
  it('用例 13：未核验目标 412 RISK_CONFIRM_REQUIRED（不扣费）；确认后 200 且留痕 riskConfirmed', async () => {
    const { u, tp } = await fixturePair('c13', false);
    await grantQuota(u.id, 2);

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c13_${suffix}`)
      .send({ profileId: tp.id.toString(), riskConfirmed: false })
      .expect(412);
    expect(blocked.body.errorCode).toBe('RISK_CONFIRM_REQUIRED');
    expect(blocked.body.message).toContain('风险');
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { userId: u.id } });
    expect(batch.remaining).toBe(2); // 门闸先于扣费

    const ok = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_c13b_${suffix}`)
      .send({ profileId: tp.id.toString(), riskConfirmed: true })
      .expect(200);
    expect(ok.body.quotaRemainAfter).toBe(1);
    const rec = await prisma.unlockRecord.findUniqueOrThrow({ where: { id: BigInt(ok.body.unlockId) } });
    expect(rec.riskConfirmed).toBe(true);
  });

  // ==================== 实名门闸 + check 四态 ====================
  it('未实名 402 REALNAME_REQUIRED；check 返回 realname_required / need_payment / quota_available / already_unlocked', async () => {
    const u = await newUser('nr'); // 未实名
    await makeProfile(u.id, true);
    const { tp } = await fixturePair('nr_t');

    const res = await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_nr_${suffix}`)
      .send({ profileId: tp.id.toString() }).expect(402);
    expect(res.body.errorCode).toBe('REALNAME_REQUIRED');
    const chk = await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(chk.body.state).toBe('realname_required');

    await realname(u.id, 'nr');
    const chk2 = await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(chk2.body).toMatchObject({ state: 'need_payment', oncePriceCent: ONCE_PRICE, targetMaritalVerified: true });

    await grantQuota(u.id, 1);
    const chk3 = await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(chk3.body.state).toBe('quota_available');

    await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_nr2_${suffix}`).send({ profileId: tp.id.toString() }).expect(200);
    const chk4 = await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(chk4.body).toMatchObject({ state: 'already_unlocked' });
    expect(chk4.body.expireAt).toBeTruthy();

    // 自己的档案 400；未上线 404
    const own = await makeProfile(u.id, true, false); // 第二档案（非生效，仅测自查拦截）
    await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: own.id.toString() }).expect(400);
    const draft = await prisma.profile.create({
      data: { matchNo: `MNdraft_${suffix}`, ownerUserId: (await newUser('d_t')).id, relation: 'SELF', gender: 'MALE', birthYear: 1990, heightCm: 175, education: 'COLLEGE', occupation: '工程师', residenceCity: '宁波', photos: [], auditStatus: 'PENDING' },
    });
    await request(app.getHttpServer()).post('/api/v1/unlock/check').set(auth(u.token)).send({ profileId: draft.id.toString() }).expect(404);
  });

  // ==================== 券：全额抵扣即时解锁 / 部分抵扣预支付 ====================
  it('券全额抵扣 → 即时 COUPON 解锁免支付；部分抵扣 → 202 应付=价差；券下单即占防多用', async () => {
    const { u, tp } = await fixturePair('cp');
    const full = await giveCoupon(u.id, CouponScope.UNLOCK, ONCE_PRICE);
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/orders').set(auth(u.token))
      .send({ type: 'UNLOCK_ONCE', targetProfileId: tp.id.toString(), userCouponId: full.id.toString() })
      .expect(201);
    expect(r1.body.amountCent).toBe(0);
    const rec1 = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: u.id } });
    expect(rec1.payType).toBe('COUPON');
    const usedCoupon = await prisma.userCoupon.findUniqueOrThrow({ where: { id: full.id } });
    expect(usedCoupon.status).toBe('USED');

    // 同券再用 → COUPON_INVALID
    const { tp: tp2 } = await fixturePair('cp2_owner');
    const t2 = await newUser('cp_t2'); await realname(t2.id, 'cp_t2'); const tpB = await makeProfile(t2.id, true);
    const dup = await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u.token))
      .send({ type: 'UNLOCK_ONCE', targetProfileId: tpB.id.toString(), userCouponId: full.id.toString() }).expect(400);
    expect(dup.body.errorCode).toBe('COUPON_INVALID');
    void tp2;

    // 部分抵扣：19.9 - 10 = 9.9
    const { u: u2, tp: tp3 } = await fixturePair('cp3');
    const half = await giveCoupon(u2.id, CouponScope.UNLOCK, 1000);
    const r2 = await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u2.token)).set('Idempotency-Key', `IK_cp3_${suffix}`)
      .send({ profileId: tp3.id.toString(), userCouponId: half.id.toString() }).expect(202);
    expect(r2.body.order).toMatchObject({ amountCent: 990, couponDeductCent: 1000 });
    // 下单即占：券已 USED
    expect((await prisma.userCoupon.findUniqueOrThrow({ where: { id: half.id } })).status).toBe('USED');
    // 回调履约：payType=COUPON（订单挂券）
    await payCallback(r2.body.order.outTradeNo, `TXN_cp3_${suffix}`);
    const rec2 = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: u2.id } });
    expect(rec2.payType).toBe('COUPON');

    // 门槛不足：minAmount > 原价
    const { u: u3, tp: tp4 } = await fixturePair('cp4');
    const bigMin = await giveCoupon(u3.id, CouponScope.UNLOCK, 1000, 999999);
    const rej = await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u3.token)).set('Idempotency-Key', `IK_cp4_${suffix}`)
      .send({ profileId: tp4.id.toString(), userCouponId: bigMin.id.toString() }).expect(400);
    expect(rej.body.errorCode).toBe('COUPON_INVALID');
  });

  // ==================== 会员：套餐/购单/回调发放/会员卡/0元券 ====================
  it('会员链路：plans 读配置 → MEMBER 订单 201 → 回调发 30d+30 额度 quotaGranted → /member/me；0 元券直购', async () => {
    const plans = await request(app.getHttpServer()).get('/api/v1/member/plans').expect(200);
    expect(plans.body).toHaveLength(3);
    expect(plans.body[0]).toMatchObject({ planId: 'month', days: 30, quota: 30, amountCent: 9900 });

    const u = await newUser('mb');
    const order = await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u.token)).send({ type: 'MEMBER', planId: 'month' }).expect(201);
    expect(order.body).toMatchObject({ amountCent: 9900, confirmRequired: false });
    const got = await request(app.getHttpServer()).get(`/api/v1/orders/${order.body.orderId}`).set(auth(u.token)).expect(200);
    expect(got.body.payStatus).toBe('CREATED');
    const oth = await newUser('oth');
    await request(app.getHttpServer()).get(`/api/v1/orders/${order.body.orderId}`).set(auth(oth.token)).expect(404);

    await payCallback(order.body.outTradeNo, `TXN_mb_${suffix}`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.memberLevel).toBe('PAID');
    expect((user.memberExpireAt!.getTime() - Date.now()) / 864e5).toBeGreaterThan(29.9);
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { userId: u.id } });
    expect(batch).toMatchObject({ remaining: 30, status: 'ACTIVE' });
    const ord = await prisma.order.findUniqueOrThrow({ where: { outTradeNo: order.body.outTradeNo } });
    expect(ord.quotaGranted).toBe(true);

    const card = await request(app.getHttpServer()).get('/api/v1/member/me').set(auth(u.token)).expect(200);
    expect(card.body.level).toBe('PAID');
    expect(card.body.quota.totalRemaining).toBe(30);
    expect(card.body.privileges.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
    expect(card.body.renewRemind.nextRemindAt).toBeTruthy();

    // 大额二次确认 + 0 元券直购会员
    const u2 = await newUser('mb2');
    await realname(u2.id, 'mb2');
    const year = await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u2.token)).send({ type: 'MEMBER', planId: 'year' }).expect(201);
    expect(year.body.confirmRequired).toBe(true); // 799 ≥ 阈值 500
    const freeTpl = await giveCoupon(u2.id, CouponScope.MEMBER, 9900);
    const z = await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u2.token)).send({ type: 'MEMBER', planId: 'month', userCouponId: freeTpl.id.toString() }).expect(201);
    expect(z.body.amountCent).toBe(0);
    const u2fresh = await prisma.user.findUniqueOrThrow({ where: { id: u2.id } });
    expect(u2fresh.memberLevel).toBe('PAID');

    // 未知类型 / 非法参数
    await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u2.token)).send({ type: '???', planId: 'month' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u2.token)).send({ type: 'MEMBER' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/orders').set(auth(u2.token)).send({ type: 'MEMBER', planId: 'nope' }).expect(400);
  });

  // ==================== 用例 3：过期清扫 → 重新解锁重走扣费 → 会话历史保留 ====================
  it('用例 3 + 状态机四态：ACTIVE→EXPIRED(任务)→重解锁新记录再扣费；ACTIVE→REFUNDED 返还额度；会话保留', async () => {
    const { u, tp } = await fixturePair('ex');
    await grantQuota(u.id, 2);
    const r1 = await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_ex1_${suffix}`).send({ profileId: tp.id.toString() }).expect(200);
    const id1 = BigInt(r1.body.unlockId);
    const conv1 = await prisma.conversation.findFirstOrThrow({ where: { unlockRecordId: id1 } });

    // 置过期 → 定时任务清扫
    await prisma.unlockRecord.update({ where: { id: id1 }, data: { expireAt: new Date(Date.now() - 1000) } });
    const { UnlockExpiryJob } = await import('../src/modules/unlock/unlock-expiry.job');
    const swept = await app.get(UnlockExpiryJob).handle();
    expect((await prisma.unlockRecord.findUniqueOrThrow({ where: { id: id1 } })).status).toBe(UnlockStatus.EXPIRED);
    void swept;
    // 过期后不可复用（会话仍在，canSend=false）
    const view = await unlockSvc.conversationView(conv1, u.id, (await prisma.unlockRecord.findUniqueOrThrow({ where: { id: id1 } })).expireAt);
    expect(view.canSend).toBe(false);

    // 重新解锁：重走扣费，新 ACTIVE 记录（同 pair 不同 status 允许共存历史）
    const r2 = await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_ex2_${suffix}`).send({ profileId: tp.id.toString() }).expect(200);
    const id2 = BigInt(r2.body.unlockId);
    expect(id2).not.toBe(id1);
    const batch = await prisma.memberQuota.findFirstOrThrow({ where: { userId: u.id } });
    expect(batch.remaining).toBe(0); // 共扣 2
    expect(await prisma.conversation.findUnique({ where: { id: conv1.id } })).not.toBeNull(); // 会话历史保留

    // Refunded：返还额度 + 流水
    const refund = await unlockSvc.refundQuotaUnlock(id2);
    expect(refund.refundedQuota).toBe(true);
    expect((await prisma.unlockRecord.findUniqueOrThrow({ where: { id: id2 } })).status).toBe(UnlockStatus.REFUNDED);
    expect((await prisma.memberQuota.findUniqueOrThrow({ where: { id: batch.id } })).remaining).toBe(1);
    const refundLog = await prisma.quotaTxLog.findFirstOrThrow({ where: { userId: u.id, reason: 'REFUND' } });
    expect(refundLog).toMatchObject({ change: 1, refType: 'unlock', refId: id2 });
    await expect(unlockSvc.refundQuotaUnlock(id2)).rejects.toThrow(); // 仅 ACTIVE 可退
  });

  // ==================== 性能门槛：解锁接口 P99 < 200ms（本地基准） ====================
  it('性能：20 次不同目标解锁（真实 MySQL 行锁扣减）P99 < 200ms', async () => {
    const u = await newUser('perf');
    await realname(u.id, 'perf');
    await makeProfile(u.id, true);
    await grantQuota(u.id, 30);
    const owners: bigint[] = [];
    for (let i = 0; i < 20; i++) {
      const t = await newUser(`pt${i}`);
      await realname(t.id, `pt${i}`);
      owners.push((await makeProfile(t.id, true)).id);
    }
    const lat: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(u.token)).set('Idempotency-Key', `IK_perf_${i}_${suffix}`).send({ profileId: owners[i].toString() }).expect(200);
      lat.push(Date.now() - t0);
    }
    lat.sort((a, b) => a - b);
    const p99 = lat[Math.floor(lat.length * 0.99)];
    // eslint-disable-next-line no-console
    console.log(`unlock P50=${lat[10]}ms P99=${p99}ms`);
    expect(p99).toBeLessThan(200);
  });
});
