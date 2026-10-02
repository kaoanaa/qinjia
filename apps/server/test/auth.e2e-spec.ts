import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Step 4 链路：openid → user → frozen quota（PLAN Exit 标准）
 * 使用随机 code 隔离数据；provider 为 mock（MOCK_PROVIDERS=true）。
 */
describe('Auth + 新手礼 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const codeA = `A_${suffix}`;
  const codeB = `B_${suffix}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('A 首次登录：自动注册 + 发 7 天/10 额度 frozen（D9）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ code: codeA, deviceFingerprint: 'fp_test_a' })
      .expect(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.memberLevel).toBe('TRIAL');
    expect(res.body.user.realnamePassed).toBe(false);
    expect(res.body.user.inviteCode).toHaveLength(8);

    const balance = await request(app.getHttpServer())
      .get('/api/v1/quota/balance')
      .set('Authorization', `Bearer ${res.body.token}`)
      .expect(200);
    expect(balance.body.frozenTotal).toBe(10);
    expect(balance.body.totalRemaining).toBe(0); // 未实名不可用（用例 11）
    expect(balance.body.batches[0]).toMatchObject({ source: 'NEWBIE', status: 'FROZEN' });
    const daysToExpire = (new Date(balance.body.batches[0].expireAt).getTime() - Date.now()) / 864e5;
    expect(daysToExpire).toBeGreaterThan(6.9);
    expect(daysToExpire).toBeLessThanOrEqual(7);
  });

  it('A 重复登录：不重复发奖', async () => {
    const first = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeA }).expect(201);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeA }).expect(201);
    expect(res.body.isNewUser).toBe(false);
    const balance = await request(app.getHttpServer())
      .get('/api/v1/quota/balance')
      .set('Authorization', `Bearer ${res.body.token}`)
      .expect(200);
    expect(balance.body.frozenTotal).toBe(10);
    expect(balance.body.batches).toHaveLength(1);
    expect(first.body.user.id).toBe(res.body.user.id);
  });

  it('A 绑定手机号 + me 返回额度摘要', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeA }).expect(201);
    const token = login.body.token;
    const bind = await request(app.getHttpServer())
      .post('/api/v1/auth/bind-phone')
      .set('Authorization', `Bearer ${token}`)
      .send({ phoneCode: suffix.slice(-8) })
      .expect(201);
    expect(bind.body.phoneMasked).toMatch(/^130\*{4}\d{4}$/);

    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.quotaBalance.frozenTotal).toBe(10);
  });

  it('无 token 访问受保护接口 → 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/quota/balance').expect(401);
  });

  it('B 携 A 的邀请码注册：登记 Referral PENDING，不发奖（用例 12 前置）', async () => {
    const loginA = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeA }).expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ code: codeB, inviteCode: loginA.body.user.inviteCode })
      .expect(201);
    expect(res.body.isNewUser).toBe(true);

    const userB = await prisma.user.findUnique({ where: { openid: `mock_openid_${codeB}` } });
    expect(userB?.invitedByUserId).toBeDefined();
    const referral = await prisma.referral.findUnique({ where: { inviteeId: userB!.id } });
    expect(referral?.rewardStatus).toBe('PENDING');
  });

  it('手机号被占用 → 400 友好文案', async () => {
    const a = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeA }).expect(201);
    const b = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: codeB }).expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/bind-phone')
      .set('Authorization', `Bearer ${b.body.token}`)
      .send({ phoneCode: suffix.slice(-8) }) // 与 A 相同号段
      .expect(400);
  });
});
