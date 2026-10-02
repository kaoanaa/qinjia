import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QuotaSource, QuotaStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuotaService } from '../src/modules/quota/quota.service';

/**
 * Step 7 资金安全核心（红线 I2）：真实 MySQL 上行锁 FEFO 扣减，禁止 mock 数据库。
 * 覆盖：用例 9（FEFO 顺序）、用例 10（100 并发仅扣 1 次）、frozen 不可扣、过期防御、D10 顺延/重激活。
 */
describe('额度账本 FEFO (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let quota: QuotaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function newUser(tag: string): Promise<bigint> {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `L_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_L_${tag}_${suffix}` } });
    // 隔离：注册赠送的 frozen 批次不参与本测试
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } });
    return user.id;
  }

  async function addBatch(userId: bigint, data: { remaining: number; days: number; source?: QuotaSource; status?: QuotaStatus }): Promise<bigint> {
    const b = await prisma.memberQuota.create({
      data: {
        userId,
        source: data.source ?? QuotaSource.PAID,
        total: data.remaining,
        remaining: data.remaining,
        status: data.status ?? QuotaStatus.ACTIVE,
        expireAt: new Date(Date.now() + data.days * 864e5),
      },
    });
    return b.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    quota = app.get(QuotaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('用例 9：体验额度(剩2天) + 付费额度(剩300天) 并存 → 先扣体验额度，扣完转扣付费', async () => {
    const userId = await newUser('fefo');
    const trialId = await addBatch(userId, { remaining: 3, days: 2, source: QuotaSource.NEWBIE });
    const paidId = await addBatch(userId, { remaining: 5, days: 300 });

    for (let i = 0; i < 3; i++) {
      const r = await quota.deductOne(userId);
      expect(r?.quotaId).toBe(trialId.toString());
    }
    const r4 = await quota.deductOne(userId);
    expect(r4?.quotaId).toBe(paidId.toString());

    expect((await prisma.memberQuota.findUniqueOrThrow({ where: { id: trialId } })).remaining).toBe(0);
    expect((await prisma.memberQuota.findUniqueOrThrow({ where: { id: paidId } })).remaining).toBe(4);

    const logs = await prisma.quotaTxLog.findMany({ where: { userId, reason: 'DEDUCT' }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.change === -1 && l.refType === 'unlock')).toBe(true);
  });

  it('用例 10：100 并发扣 remaining=1 → 恰好成功 1 次，无负数无超扣', async () => {
    const userId = await newUser('race');
    const batchId = await addBatch(userId, { remaining: 1, days: 30 });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => quota.deductOne(userId).catch((e) => e)),
    );
    const success = results.filter((r) => r && !(r instanceof Error) && r !== null);
    const failures = results.filter((r) => r === null || r instanceof Error);

    expect(success).toHaveLength(1);
    expect(failures).toHaveLength(99);

    const batch = await prisma.memberQuota.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.remaining).toBe(0); // 不为负、不超扣
    const deductLogs = await prisma.quotaTxLog.count({ where: { userId, reason: 'DEDUCT' } });
    expect(deductLogs).toBe(1); // 流水与实扣一致
  });

  it('frozen 批次不可扣（未实名）；扣减返回 null → Step 8 走付费分支', async () => {
    const userId = await newUser('frozen');
    await addBatch(userId, { remaining: 10, days: 7, status: QuotaStatus.FROZEN });
    expect(await quota.deductOne(userId)).toBeNull();
  });

  it('过期未清扫防御：expire_at<=now 的 ACTIVE 批次不可扣（§6.4）；expireOverdue 置 EXPIRED 并写清零流水', async () => {
    const userId = await newUser('expired');
    const stale = await prisma.memberQuota.create({
      data: { userId, source: QuotaSource.PAID, total: 5, remaining: 5, status: QuotaStatus.ACTIVE, expireAt: new Date(Date.now() - 3600_000) },
    });

    expect(await quota.deductOne(userId)).toBeNull();

    const balance = await quota.getBalance(userId); // 读取时兜底显示 EXPIRED
    expect(balance.batches[0].status).toBe('EXPIRED');
    expect(balance.totalRemaining).toBe(0);

    const swept = await quota.expireOverdue();
    expect(swept).toBeGreaterThanOrEqual(1);
    const after = await prisma.memberQuota.findUniqueOrThrow({ where: { id: stale.id } });
    expect(after.status).toBe(QuotaStatus.EXPIRED);
    const expireLog = await prisma.quotaTxLog.findFirstOrThrow({ where: { userId, reason: 'EXPIRE' } });
    expect(expireLog.change).toBe(-5); // 清零流水（D2）
  });

  it('D10：有效会员顺延（+30 叠加到期日，额度到期=会员到期 D2）；过期会员重新激活（now 起算）', async () => {
    // 顺延
    const userIdActive = await newUser('d10a');
    await prisma.user.update({ where: { id: userIdActive }, data: { memberLevel: 'PAID', memberExpireAt: new Date(Date.now() + 10 * 864e5) } });
    await prisma.$transaction(async (tx) => {
      await quota.applyMembershipTx(tx, userIdActive, { days: 30, quota: 30, source: QuotaSource.PAID, orderId: 1n });
    });
    const u1 = await prisma.user.findUniqueOrThrow({ where: { id: userIdActive } });
    const daysLeft1 = (u1.memberExpireAt!.getTime() - Date.now()) / 864e5;
    expect(daysLeft1).toBeGreaterThan(39); // 10 + 30 顺延
    expect(daysLeft1).toBeLessThanOrEqual(40);
    const batch1 = await prisma.memberQuota.findFirstOrThrow({ where: { userId: userIdActive }, orderBy: { id: 'desc' } });
    expect(batch1.expireAt.getTime()).toBe(u1.memberExpireAt!.getTime()); // 额度到期=会员到期

    // 过期重激活
    const userIdExpired = await newUser('d10b');
    await prisma.user.update({ where: { id: userIdExpired }, data: { memberLevel: 'PAID', memberExpireAt: new Date(Date.now() - 5 * 864e5) } });
    await prisma.$transaction(async (tx) => {
      await quota.applyMembershipTx(tx, userIdExpired, { days: 30, quota: 30, source: QuotaSource.PAID, orderId: 2n });
    });
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: userIdExpired } });
    const daysLeft2 = (u2.memberExpireAt!.getTime() - Date.now()) / 864e5;
    expect(daysLeft2).toBeGreaterThan(29); // 从 now 重算，不补过期天数
    expect(daysLeft2).toBeLessThanOrEqual(30);
    expect(u2.memberLevel).toBe('PAID');
  });

  it('定时任务①：QuotaExpiryJob 正常清扫 + 异常吞掉不外泄', async () => {
    const { QuotaExpiryJob } = await import('../src/modules/quota/quota-expiry.job');
    const job = app.get(QuotaExpiryJob);
    await expect(job.handle()).resolves.toBeUndefined(); // 真实执行一次 expireOverdue（幂等）

    const spy = jest.spyOn(quota, 'expireOverdue').mockRejectedValue(new Error('db down'));
    await expect(job.handle()).resolves.toBeUndefined(); // 捕获异常，不中断调度
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('grantBatch（Step 6/8/15 复用入口）默认 ACTIVE 且写流水', async () => {
    const userId = await newUser('grant');
    await prisma.$transaction(async (tx) => {
      await quota.grantBatch(tx, { userId, source: QuotaSource.INVITE, count: 10, days: 7 });
    });
    const b = await prisma.memberQuota.findFirstOrThrow({ where: { userId } });
    expect(b.status).toBe(QuotaStatus.ACTIVE);
    const log: { reason: string; change: number } | null = await prisma.quotaTxLog.findFirst({ where: { userId, quotaId: b.id } });
    expect(log).toMatchObject({ reason: 'GRANT', change: 10 });
  });
});
