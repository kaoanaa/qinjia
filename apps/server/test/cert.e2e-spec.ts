import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ReferralRewardTrigger } from '../src/modules/cert/referral-reward-trigger';

/**
 * Step 6 链路：实名（OCR+人脸）→ 解冻（§3.1 F→H）；子女授权；三唯一（用例 15）；邀请触发埋点（用例 12 前置）
 */
describe('实名 + 子女授权 + 解冻 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const server = () => app.getHttpServer();

  async function login(code: string): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/login').send({ code }).expect(201);
    return res.body.token;
  }

  async function realnameFlow(token: string, objectKey: string) {
    const ocr = await request(server()).post('/api/v1/cert/idcard-ocr').set('Authorization', `Bearer ${token}`).send({ objectKey }).expect(200);
    expect(ocr.body.idCardNoMasked).toContain('*');
    expect(ocr.body.certId).toBeDefined();
    const init = await request(server()).post('/api/v1/cert/face-init').set('Authorization', `Bearer ${token}`).send({}).expect(200);
    expect(init.body.verifyUrl).toBeTruthy();
    const verify = await request(server()).post('/api/v1/cert/face-verify').set('Authorization', `Bearer ${token}`).send({ sessionId: init.body.sessionId }).expect(200);
    return verify.body as { passed: boolean; duplicateIdCard: boolean; quotaBalance: { totalRemaining: number; frozenTotal: number; batches: { status: string }[] } };
  }

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

  it('用例 11：未实名 frozen=10 / usable=0 → 实名通过后解冻为 active', async () => {
    const token = await login(`R1_${suffix}`);
    const before = await request(server()).get('/api/v1/quota/balance').set('Authorization', `Bearer ${token}`).expect(200);
    expect(before.body.frozenTotal).toBe(10);
    expect(before.body.totalRemaining).toBe(0); // 未实名不可用 → 前端按钮置灰

    const r = await realnameFlow(token, `id_card/ocr_${suffix}_1.jpg`);
    expect(r.passed).toBe(true);
    expect(r.quotaBalance.totalRemaining).toBe(10);
    expect(r.quotaBalance.frozenTotal).toBe(0);
    expect(r.quotaBalance.batches.every((b) => b.status === 'ACTIVE')).toBe(true);

    const user = await prisma.user.findUnique({ where: { openid: `mock_openid_R1_${suffix}` } });
    expect(user?.idCardNoHash).toBeTruthy();
  });

  it('face-verify 幂等：重复回调不重复解冻', async () => {
    const token = await login(`R2_${suffix}`);
    const ocr = await request(server()).post('/api/v1/cert/idcard-ocr').set('Authorization', `Bearer ${token}`).send({ objectKey: `id_card/ocr_${suffix}_2.jpg` }).expect(200);
    const init = await request(server()).post('/api/v1/cert/face-init').set('Authorization', `Bearer ${token}`).send({ certId: ocr.body.certId }).expect(200);
    await request(server()).post('/api/v1/cert/face-verify').set('Authorization', `Bearer ${token}`).send({ sessionId: init.body.sessionId }).expect(200);
    const again = await request(server()).post('/api/v1/cert/face-verify').set('Authorization', `Bearer ${token}`).send({ sessionId: init.body.sessionId }).expect(200);
    expect(again.body.passed).toBe(true);
    const batches = await prisma.memberQuota.count({ where: { userId: BigInt((await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_R2_${suffix}` } })).id) } });
    expect(batches).toBe(1); // 仅新手礼一笔，未重复发放
  });

  it('关系≠本人：无授权 → 403 CONSENT_REQUIRED；短信+验证后放行（§5.2/PIPL）', async () => {
    const token = await login(`R3_${suffix}`);
    await realnameFlow(token, `id_card/ocr_${suffix}_3.jpg`);
    const prof = await request(server())
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ relation: 'FATHER', gender: 'MALE', birthYear: 1995, heightCm: 178, education: 'BACHELOR', occupation: '软件工程师', residenceCity: '杭州', photoObjectKeys: ['photos/r3.jpg'] })
      .expect(201);
    const pid = prof.body.id as string;

    const denied = await request(server())
      .post(`/api/v1/profiles/${pid}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commitmentChecked: true, commitmentVersion: 'v1' })
      .expect(403);
    expect(denied.body.errorCode).toBe('CONSENT_REQUIRED');

    const phone = `139${suffix.slice(-8)}`;
    await request(server()).post('/api/v1/consent/send-sms').set('Authorization', `Bearer ${token}`).send({ profileId: pid, childPhone: phone }).expect(200);

    await request(server())
      .post('/api/v1/consent/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ profileId: pid, childPhone: phone, code: '000000', statementAccepted: true, statementVersion: 'v1' })
      .expect(400); // 验证码错误（mock 固定 123456）

    await request(server())
      .post('/api/v1/consent/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ profileId: pid, childPhone: phone, code: '123456', statementAccepted: false, statementVersion: 'v1' })
      .expect(400); // 未勾选授权声明

    const ok = await request(server())
      .post('/api/v1/consent/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ profileId: pid, childPhone: phone, code: '123456', statementAccepted: true, statementVersion: 'v1.0' })
      .expect(200);
    expect(ok.body.consentId).toBeDefined();

    const pub = await request(server())
      .post(`/api/v1/profiles/${pid}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commitmentChecked: true, commitmentVersion: 'v1' })
      .expect(200);
    expect(pub.body.consentStatus).toBe('DONE');

    // consent_record 留痕 + 手机号密文存储（I5/PIPL）
    const record = await prisma.consentRecord.findFirstOrThrow({ where: { profileId: BigInt(pid) } });
    expect(record.childPhone).not.toContain(phone); // 非明文
    expect(record.statementVersion).toBe('v1.0');
    expect(record.ip).toBeTruthy();
  });

  it('本人档案无需授权：实名后直接可发布', async () => {
    const token = await login(`R4_${suffix}`);
    await realnameFlow(token, `id_card/ocr_${suffix}_4.jpg`);
    const prof = await request(server())
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ relation: 'SELF', gender: 'FEMALE', birthYear: 1993, heightCm: 162, education: 'COLLEGE', occupation: '护士', residenceCity: '宁波', photoObjectKeys: ['photos/r4.jpg'] })
      .expect(201);
    await request(server())
      .post(`/api/v1/profiles/${prof.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commitmentChecked: true, commitmentVersion: 'v1' })
      .expect(200);
  });

  it('未实名发布 → 403 REALNAME_REQUIRED（服务端拦截，前端隐藏不算数）', async () => {
    const token = await login(`R5_${suffix}`);
    const prof = await request(server())
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ relation: 'SELF', gender: 'MALE', birthYear: 1990, heightCm: 175, education: 'HIGH_SCHOOL', occupation: '司机', residenceCity: '杭州', photoObjectKeys: ['photos/r5.jpg'] })
      .expect(201);
    const denied = await request(server())
      .post(`/api/v1/profiles/${prof.body.id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commitmentChecked: true, commitmentVersion: 'v1' })
      .expect(403);
    expect(denied.body.errorCode).toBe('REALNAME_REQUIRED');
  });

  it('用例 15：同身份证二次注册 → 实名通过但新手礼保持 frozen（无福利）', async () => {
    const token1 = await login(`R6_${suffix}`);
    const sharedKey = `id_card/dup_${suffix}.jpg`; // 同 objectKey → mock 同哈希
    await realnameFlow(token1, sharedKey);

    const token2 = await login(`R7_${suffix}`); // 第二个账号，注册即发 frozen 新手礼
    const r = await realnameFlow(token2, sharedKey);
    expect(r.passed).toBe(true);
    expect(r.duplicateIdCard).toBe(true);
    expect(r.quotaBalance.totalRemaining).toBe(0); // 未解冻 = 无福利
    expect(r.quotaBalance.frozenTotal).toBe(10);

    const user2 = await prisma.user.findUnique({ where: { openid: `mock_openid_R7_${suffix}` } });
    expect(user2?.idCardNoHash).toBeNull(); // 哈希唯一属于首个账号（三唯一）
  });

  it('用例 12 前置：被邀请人实名通过 → 触发点埋点正确，Referral 保持 PENDING（发奖在 Step 15）', async () => {
    const inviter = await request(server()).post('/api/v1/auth/login').send({ code: `R8_${suffix}` }).expect(201);
    const inviteCode = inviter.body.user.inviteCode as string;

    const invited = await request(server()).post('/api/v1/auth/login').send({ code: `R10_${suffix}`, inviteCode }).expect(201);
    expect(invited.body.isNewUser).toBe(true);

    const spy = jest.spyOn(app.get(ReferralRewardTrigger), 'onInviteeRealnamePassed');
    await realnameFlow(invited.body.token, `id_card/ocr_${suffix}_10.jpg`);
    expect(spy).toHaveBeenCalledTimes(1);

    const invitee = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_R10_${suffix}` } });
    const referral = await prisma.referral.findUniqueOrThrow({ where: { inviteeId: invitee.id } });
    expect(referral.rewardStatus).toBe('PENDING'); // Step 15 才发放
    spy.mockRestore();
  });
});
