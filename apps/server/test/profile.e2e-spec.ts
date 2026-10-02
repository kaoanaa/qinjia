import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Step 5 链路：多档案（D1）+ 发布承诺书强制校验（I4/用例5）+ matchNo 防枚举 + 编辑重审
 */
describe('Profile 建档与多档案 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let profileA: number;
  let profileB: number;

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const baseDto = (over: Record<string, unknown> = {}) => ({
    relation: 'MOTHER',
    gender: 'FEMALE',
    birthYear: 1996,
    heightCm: 165,
    education: 'BACHELOR',
    occupation: '教师',
    residenceCity: '杭州',
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ code: `P_${suffix}` })
      .expect(201);
    token = login.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('新建档案：生成 matchNo（QJ+8位去混淆），首份自动生效，状态 DRAFT', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/profiles').set(auth()).send(baseDto()).expect(201);
    profileA = Number(res.body.id);
    expect(res.body.matchNo).toMatch(/^QJ[2-9A-HJ-NP-Z]{8}$/);
    expect(res.body.isActive).toBe(true);
    expect(res.body.auditStatus).toBe('DRAFT');
    expect(res.body.consentStatus).toBe('PENDING'); // 关系≠SELF
  });

  it('本人档案 consentStatus=NOT_REQUIRED；matchNo 全局唯一', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/profiles')
      .set(auth())
      .send(baseDto({ relation: 'SELF', photoObjectKeys: ['photos/x1.jpg'] }))
      .expect(201);
    profileB = Number(res.body.id);
    expect(res.body.consentStatus).toBe('NOT_REQUIRED');
    expect(res.body.isActive).toBe(false); // 非首份不自动生效
    const count = await prisma.profile.groupBy({ by: ['matchNo'], having: { matchNo: { _count: { gt: 1 } } } });
    expect(count).toHaveLength(0);
  });

  it('未勾选承诺书发布 → 403 COMMITMENT_REQUIRED（用例 5 / 红线 I4）', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/profiles/${profileA}/publish`)
      .set(auth())
      .send({ commitmentChecked: false, commitmentVersion: 'v1' })
      .expect(403);
    expect(res.body.errorCode).toBe('COMMITMENT_REQUIRED');
  });

  it('无照片发布 → 400 友好文案', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/profiles/${profileA}/publish`)
      .set(auth())
      .send({ commitmentChecked: true, commitmentVersion: 'v1' })
      .expect(400);
  });

  it('编辑补照片后发布成功：PENDING + 承诺书留痕（签名时间/IP/版本）', async () => {
    const upd = await request(app.getHttpServer())
      .put(`/api/v1/profiles/${profileA}`)
      .set(auth())
      .send(baseDto({ photoObjectKeys: ['photos/a1.jpg', 'photos/a2.jpg'] }))
      .expect(200);
    expect(upd.body.photoObjectKeys).toEqual(['photos/a1.jpg', 'photos/a2.jpg']);
    expect(upd.body.auditStatus).toBe('DRAFT'); // DRAFT 编辑不触发重审

    const pub = await request(app.getHttpServer())
      .post(`/api/v1/profiles/${profileA}/publish`)
      .set(auth())
      .send({ commitmentChecked: true, commitmentVersion: 'v1.0' })
      .expect(200);
    expect(pub.body.auditStatus).toBe('PENDING');
    expect(pub.body.publishedAt).not.toBeNull();
    expect(pub.body.singleCommitmentSignedAt).not.toBeNull();

    const row = await prisma.profile.findUnique({ where: { id: BigInt(profileA) } });
    expect(row?.singleCommitmentVersion).toBe('v1.0');
    expect(row?.singleCommitmentIp).toBeTruthy();
  });

  it('切换生效档案：非 APPROVED → 400；审核通过后切换成功且单生效不变式（D1）', async () => {
    await request(app.getHttpServer()).put('/api/v1/profiles/active').set(auth()).send({ profileId: String(profileB) }).expect(400);

    await prisma.profile.update({ where: { id: BigInt(profileB) }, data: { auditStatus: 'APPROVED' } });
    const sw = await request(app.getHttpServer()).put('/api/v1/profiles/active').set(auth()).send({ profileId: String(profileB) }).expect(200);
    expect(sw.body.isActive).toBe(true);

    const actives = await prisma.profile.count({ where: { isActive: true } }); // 全局表级断言（含其他历史数据则放宽为本人）
    const mine = await prisma.profile.findMany({ where: { isActive: true }, select: { ownerUserId: true } });
    const ownerIds = new Set(mine.map((m) => String(m.ownerUserId)));
    expect(ownerIds.size).toBe(actives); // 每个用户至多 1 份生效档案

    const active = await request(app.getHttpServer()).get('/api/v1/profiles/active').set(auth()).expect(200);
    expect(Number(active.body.id)).toBe(profileB);
  });

  it('已生效/过审档案编辑 → 重置 PENDING 重审；发布态绿标不因上传证明自动点亮（D5）', async () => {
    const upd = await request(app.getHttpServer())
      .put(`/api/v1/profiles/${profileB}`)
      .set(auth())
      .send(baseDto({ relation: 'SELF', occupation: '工程师' }))
      .expect(200);
    expect(upd.body.auditStatus).toBe('PENDING');

    const proof = await request(app.getHttpServer())
      .post(`/api/v1/profiles/${profileB}/marital-proof`)
      .set(auth())
      .send({ objectKeys: ['marital_proof/p1.jpg'] })
      .expect(200);
    expect(proof.body.hasMaritalProof).toBe(true);
    expect(proof.body.isMaritalVerified).toBe(false); // Step 13 审核后台才置位
  });

  it('越权访问他人档案 → 404；非法 id → 404', async () => {
    const other = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `Q_${suffix}` }).expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/profiles/${profileA}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .expect(404);
    await request(app.getHttpServer()).get('/api/v1/profiles/abc').set(auth()).expect(404);
  });

  it('media/upload-token：返回 objectKey + uploadUrl + expiresAt', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/media/upload-token').set(auth()).send({ bucket: 'photos' }).expect(200);
    expect(res.body.objectKey).toMatch(/^photos\//);
    expect(res.body.uploadUrl).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
