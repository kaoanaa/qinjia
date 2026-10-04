import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { MemberRemindJob } from '../src/modules/order/member-remind.job';

/**
 * Step 15 邀请裂变 + 优惠券 + 续费提醒（PRD §5.10/§5.11/D10，用例 12/14）。真实 MySQL/Redis。
 * 覆盖：实名通过发奖（+7天/+10额度 D10 顺延/重激活）、三唯一二次校验（同设备多开 REJECTED）、
 *      invite/info|poster、coupons/mine（倒计时+过期兜底）、提醒节点任务（体验前2天发券/付费前7天提醒）+ 去重。
 */
describe('邀请裂变与续费提醒 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let remindJob: MemberRemindJob;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  async function newUser(tag: string, inviteCode?: string): Promise<{ id: bigint; token: string }> {
    const login = await request(server()).post('/api/v1/auth/login').send({ code: `IN_${tag}_${suffix}`, ...(inviteCode ? { inviteCode } : {}) }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_IN_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } }); // 隔离注册赠礼，按需受控
    return { id: user.id, token: login.body.token };
  }

  const ocrKey = () => `id_card/ocr_IN_${randomUUID().slice(0, 8)}`;

  /** 完整实名（OCR+人脸 mock），触发解冻与邀请发奖 */
  async function realname(token: string) {
    await request(server()).post('/api/v1/cert/idcard-ocr').set(auth(token)).send({ objectKey: ocrKey() }).expect(200);
    const init = await request(server()).post('/api/v1/cert/face-init').set(auth(token)).send({}).expect(200);
    const verify = await request(server()).post('/api/v1/cert/face-verify').set(auth(token)).send({ sessionId: init.body.sessionId }).expect(200);
    return verify.body as { passed: boolean; duplicateIdCard: boolean };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    remindJob = app.get(MemberRemindJob);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 用例 12：被邀请人实名通过才发奖（D10） ====================
  it('用例 12：注册挂 Referral 不发奖 → 被邀请人实名通过 → 邀请人 +7天会员(顺延)+10额度 + 系统消息', async () => {
    const a = await newUser('a12');
    // 隔离会员态：注册赠 7 天 TRIAL（D9），验证“过期重激活”需先清零（newUser 已删额度批次）
    await prisma.user.update({ where: { id: a.id }, data: { memberLevel: 'NONE', memberExpireAt: null } });
    await realname(a.token); // A 自身实名
    const aUser = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });

    // B 携 A 邀请码注册：PENDING、不发奖
    const b = await newUser('b12', aUser.inviteCode);
    await prisma.user.update({ where: { id: b.id }, data: { deviceFingerprint: `dev_b12_${suffix}` } });
    const ref1 = await prisma.referral.findUniqueOrThrow({ where: { inviteeId: b.id } });
    expect(ref1.rewardStatus).toBe('PENDING');
    const bal = await prisma.memberQuota.aggregate({ where: { userId: a.id, status: 'ACTIVE' }, _sum: { remaining: true } });
    expect(bal._sum.remaining ?? 0).toBe(0);

    // B 实名通过 → 发奖：+7 天 +10 额度（A 过期重激活 → TRIAL）
    await realname(b.token);
    const ref2 = await prisma.referral.findUniqueOrThrow({ where: { inviteeId: b.id } });
    expect(ref2.rewardStatus).toBe('REWARDED');
    expect(ref2.rewardedAt).toBeTruthy();

    const aAfter = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(aAfter.memberLevel).toBe('TRIAL');
    const in7 = aAfter.memberExpireAt!.getTime() - Date.now();
    expect(in7).toBeGreaterThan(6 * 864e5);
    expect(in7).toBeLessThan(8 * 864e5);
    const invBatch = await prisma.memberQuota.findFirstOrThrow({ where: { userId: a.id, source: 'INVITE' } });
    expect(invBatch.remaining).toBe(10);
    expect(invBatch.status).toBe('ACTIVE');
    const tx = await prisma.quotaTxLog.findFirst({ where: { quotaId: invBatch.id, reason: 'GRANT' } });
    expect(tx).toBeTruthy();

    // 系统消息到账（标题话术读 copywriting.notifyTemplates.inviteReward，红线 I1 不写死）
    const copyRow = await prisma.rewardConfig.findUniqueOrThrow({ where: { configKey: 'copywriting' } });
    const tpl = (copyRow.value as unknown as { notifyTemplates: Record<string, { title: string }> }).notifyTemplates.inviteReward;
    const notif = await prisma.systemNotification.findFirst({ where: { userId: a.id, category: 'reward', title: tpl.title } });
    expect(notif).toBeTruthy();

    // C 与已发奖被邀请人 B 同设备指纹 → 实名通过后发奖处二次校验拒绝，A 不叠加
    const c = await newUser('c12', aUser.inviteCode);
    await prisma.user.update({ where: { id: c.id }, data: { deviceFingerprint: `dev_b12_${suffix}` } }); // 设备多开
    await realname(c.token);
    const refC = await prisma.referral.findUniqueOrThrow({ where: { inviteeId: c.id } });
    expect(refC.rewardStatus).toBe('REJECTED');
    const invCnt = await prisma.memberQuota.count({ where: { userId: a.id, source: 'INVITE' } });
    expect(invCnt).toBe(1);

    // D 新设备实名 → 第二笔奖励：有效期内顺延（expireAt 再 +7 天）
    const beforeExpire = (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).memberExpireAt!.getTime();
    const d = await newUser('d12', aUser.inviteCode);
    await prisma.user.update({ where: { id: d.id }, data: { deviceFingerprint: `dev_d12_${suffix}` } });
    await realname(d.token);
    const refD = await prisma.referral.findUniqueOrThrow({ where: { inviteeId: d.id } });
    expect(refD.rewardStatus).toBe('REWARDED');
    const afterExpire = (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).memberExpireAt!.getTime();
    expect(afterExpire - beforeExpire).toBeGreaterThan(6 * 864e5); // 顺延而非重置
    expect(afterExpire).toBeGreaterThan(beforeExpire);
    const aBatches = await prisma.memberQuota.findMany({ where: { userId: a.id, source: 'INVITE', status: 'ACTIVE' } });
    expect(aBatches.length).toBe(2);
  });

  // ==================== invite/info & poster（契约 §coupon&invite） ====================
  it('GET /invite/info：邀请码+规则(读配置填充)+脱敏记录；POST /invite/poster 返回素材', async () => {
    const a = await newUser('ainfo');
    const res = await request(server()).get('/api/v1/invite/info').set(auth(a.token)).expect(200);
    const aUser = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(res.body.inviteCode).toBe(aUser.inviteCode);
    expect(res.body.rewardRule.days).toBe(7);
    expect(res.body.rewardRule.quota).toBe(10);
    expect(res.body.rewardRule.tip).toContain('7');
    expect(res.body.rewardRule.tip).not.toContain('{days}'); // 占位符已填充
    // 挂一条被邀请记录验证脱敏（I5）
    const b = await newUser('binfo', aUser.inviteCode);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
    await prisma.user.update({ where: { id: bUser.id }, data: { nickname: '王大锤' } });
    const res2 = await request(server()).get('/api/v1/invite/info').set(auth(a.token)).expect(200);
    const rec = res2.body.records.find((r: { inviteeMasked: string }) => r.inviteeMasked.includes('王'));
    expect(rec).toBeTruthy();
    expect(rec.inviteeMasked).not.toBe('王大锤');
    expect(rec.rewardStatus).toBe('PENDING');

    const poster = await request(server()).post('/api/v1/invite/poster').set(auth(a.token)).expect(200);
    expect(poster.body.posterUrl).toContain('mock-cdn.local');
    expect(poster.body.inviteCode).toBe(aUser.inviteCode);
  });

  // ==================== 用例 14：提醒节点（体验前2天发券 / 付费前7天提醒）+ 去重 ====================
  it('用例 14：TRIAL 到期前 2 天 → 续费券+系统消息；PAID 到期前 7 天 → 提醒；同周期不重复发', async () => {
    const now = Date.now();
    // 体验会员：剩 1 天（≤2 天窗）
    const trial = await newUser('t14');
    await prisma.user.update({ where: { id: trial.id }, data: { memberLevel: 'TRIAL', memberExpireAt: new Date(now + 1 * 864e5) } });
    // 付费会员：剩 5 天（≤7 天窗）
    const paid = await newUser('p14');
    await prisma.user.update({ where: { id: paid.id }, data: { memberLevel: 'PAID', memberExpireAt: new Date(now + 5 * 864e5) } });
    // 付费会员：剩 20 天（窗外，不打扰）
    const far = await newUser('f14');
    await prisma.user.update({ where: { id: far.id }, data: { memberLevel: 'PAID', memberExpireAt: new Date(now + 20 * 864e5) } });

    const first = await remindJob.remindNow();
    expect(first.trialReminded).toBeGreaterThanOrEqual(1);
    expect(first.paidReminded).toBeGreaterThanOrEqual(1);

    const coupon = await prisma.userCoupon.findFirst({ where: { userId: trial.id, source: 'renew_push' }, include: { template: true } });
    expect(coupon).toBeTruthy();
    expect(coupon!.template.name).toBe('体验到期续费券'); // 模板来自 coupon_templates 配置
    const trialNotif = await prisma.systemNotification.findFirst({ where: { userId: trial.id, category: 'activity' } });
    expect(trialNotif).toBeTruthy();
    const paidNotif = await prisma.systemNotification.findFirst({ where: { userId: paid.id, category: 'activity' } });
    expect(paidNotif).toBeTruthy();
    expect(await prisma.systemNotification.count({ where: { userId: far.id } })).toBe(0); // 窗外打扰=0

    // 去重：同周期重跑不再发（RemindLog 唯一锚）
    const couponCntBefore = await prisma.userCoupon.count({ where: { userId: trial.id } });
    await remindJob.remindNow();
    const logs = await prisma.remindLog.findMany({ where: { userId: { in: [trial.id, paid.id] } } });
    expect(logs.length).toBe(2);
    const second = await remindJob.remindNow();
    void second;
    expect(await prisma.userCoupon.count({ where: { userId: trial.id } })).toBe(couponCntBefore);

    // 续费后新到期日 → 允许再次提醒（锚定 memberExpireAt）
    await prisma.user.update({ where: { id: trial.id }, data: { memberExpireAt: new Date(Date.now() + 1 * 864e5) } });
    await remindJob.remindNow();
    expect(await prisma.remindLog.count({ where: { userId: trial.id, kind: 'TRIAL_RENEW' } })).toBe(2);
  });

  // ==================== coupons/mine（面额+倒计时+过期兜底） ====================
  it('GET /coupons/mine：UNUSED 带 expireInMs；过期 UNUSED 展示 EXPIRED；非法 status 400', async () => {
    const u = await newUser('cpn');
    const tpl = await prisma.couponTemplate.create({
      data: { name: `测试券_${suffix}`, scope: 'MEMBER', amountCent: 2000, minAmountCent: 0, validDays: 7, startAt: new Date(), endAt: new Date(Date.now() + 7 * 864e5) },
    });
    await prisma.userCoupon.create({ data: { templateId: tpl.id, userId: u.id, expireAt: new Date(Date.now() + 3 * 864e5), source: 'test' } });
    await prisma.userCoupon.create({ data: { templateId: tpl.id, userId: u.id, expireAt: new Date(Date.now() - 3600_000), source: 'test' } });

    const res = await request(server()).get('/api/v1/coupons/mine').set(auth(u.token)).expect(200);
    expect(res.body.length).toBe(2);
    const active = res.body.find((c: { status: string }) => c.status === 'UNUSED');
    expect(active.amountCent).toBe(2000);
    expect(active.expireInMs).toBeGreaterThan(0);
    expect(res.body.some((c: { status: string }) => c.status === 'EXPIRED')).toBe(true); // 兜底展示

    await request(server()).get('/api/v1/coupons/mine').query({ status: 'BOGUS' }).set(auth(u.token)).expect(400);
  });
});
