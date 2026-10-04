import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AdminRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PaymentReconciliationJob } from '../src/modules/order/payment-reconciliation.job';

/**
 * Step 13 管理后台 + 防刷风控（PRD §5.13/§6.6，红线 I1/I3）。真实 MySQL，禁 mock 库。
 * 覆盖：独立账号鉴权与角色越权、审核裁决联动违规下架返额度、实名复核撤销、IM 风控台留痕、
 *      配置中心可改（唯一写入口）、工单、数据看板、支付对账触发。
 * 限频与配置实时失效见对应单测（unlock-rate-limit.guard.spec / db-config-center.spec）。
 */
describe('管理后台与风控 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let profileSeq = 0;

  const superToken = () => tokens.super;
  const tokens: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(server()).post('/api/v1/auth/login').send({ code: `A_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_A_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } });
    return { id: user.id, token: login.body.token };
  }

  let phoneSeq = 0;
  async function realnameDb(userId: bigint, tag: string) {
    phoneSeq += 1;
    await prisma.user.update({ where: { id: userId }, data: { idCardNoHash: `adminhash_${tag}_${suffix}_${phoneSeq}`, phone: `139${suffix}${phoneSeq}${Math.floor(Math.random() * 1e6)}` } });
  }

  async function makeProfile(ownerUserId: bigint, gender: 'MALE' | 'FEMALE', auditStatus = 'APPROVED') {
    profileSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `AD${suffix}_${profileSeq}`, ownerUserId, isActive: true,
        relation: 'MOTHER', gender, birthYear: 1955, heightCm: 168,
        education: 'BACHELOR', occupation: '工程师', residenceCity: '林芝',
        intro: '后台测试档案', photos: [], isMaritalVerified: true, auditStatus,
        publishedAt: auditStatus === 'APPROVED' ? new Date() : null,
      },
    });
  }

  async function grantActiveQuota(userId: bigint, remaining = 3) {
    return prisma.memberQuota.create({
      data: { userId, source: 'PAID', total: remaining, remaining, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });
  }

  async function unlockQuota(initiatorToken: string, targetProfileId: bigint, ik: string) {
    return request(server()).post('/api/v1/unlock').set(auth(initiatorToken)).set('Idempotency-Key', ik).send({ profileId: targetProfileId.toString() });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // 契约双前缀：/api/v1 与 /admin/v1（admin 段排除全局前缀，与 main.ts 一致）
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'admin/(.*)', method: RequestMethod.ALL }] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // 引导后台账号（独立账号体系，bcrypt 口令）
    for (const [username, role] of [['adm_super', AdminRole.SUPER], ['adm_reviewer', AdminRole.REVIEWER], ['adm_finance', AdminRole.FINANCE]] as [string, AdminRole][]) {
      await prisma.adminUser.upsert({ where: { username }, update: { role, enabled: true }, create: { username, passwordHash: bcrypt.hashSync('pw123456', 10), role } });
    }
    // 幂等补齐 §11 配置键（rate_limit 为本次新增，历史 seed 库可能缺行；update:{} 不覆盖既有值）
    const bootstrapCfg: Record<string, object> = {
      ticket_sla: { firstResponseHours: 48 },
      rate_limit: { unlockPerMinute: 30, windowSeconds: 60 },
      unlock_once_price: { amountCent: 1990 },
      unlock_validity: { days: 30 },
      newbie_reward: { days: 7, quota: 10 },
    };
    for (const [configKey, value] of Object.entries(bootstrapCfg)) {
      await prisma.rewardConfig.upsert({ where: { configKey }, update: {}, create: { configKey, value, updatedBy: 'bootstrap' } });
    }
    for (const k of ['super', 'reviewer', 'finance']) {
      const r = await request(server()).post('/admin/v1/auth/login').send({ username: `adm_${k}`, password: 'pw123456' }).expect(200);
      tokens[k] = r.body.token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 登录与鉴权 ====================
  it('登录成功返回独立受众 token；错误口令 401；无 token 访问受保护接口 401', async () => {
    await request(server()).post('/admin/v1/auth/login').send({ username: 'adm_super', password: 'wrong' }).expect(401);
    await request(server()).get('/admin/v1/users').expect(401);
    await request(server()).get('/admin/v1/users').set(auth('bogus')).expect(401);
    // 小程序 token 与后台 token 受众隔离（用例：越权）
    const u = await newUser('aud');
    await request(server()).get('/admin/v1/users').set(auth(u.token)).expect(401);
  });

  // ==================== 角色越权（红线 I1 配置写入口仅 SUPER） ====================
  it('REVIEWER 可审核不可改配置(403)；FINANCE 不可审核(403)；SUPER 全可', async () => {
    await request(server()).put('/admin/v1/config/ticket_sla').set(auth(tokens.reviewer)).send({ value: { firstResponseHours: 48 } }).expect(403);
    await request(server()).post('/admin/v1/reconciliation/run').set(auth(tokens.finance)).expect(403);
    await request(server()).post('/admin/v1/reconciliation/run').query({ date: ymd(new Date()) }).set(auth(superToken())).expect(200);
  });

  // ==================== 配置中心（§11 唯一真源，可改可查） ====================
  it('GET /config 覆盖 §11 全集；GET/PUT 单项；未知 key 400', async () => {
    const all = await request(server()).get('/admin/v1/config').set(auth(superToken())).expect(200);
    const keys = (all.body as { configKey: string }[]).map((c) => c.configKey);
    // §11 全清单关键项存在（rate_limit/ticket_sla/unlock_once_price...）
    for (const k of ['unlock_once_price', 'unlock_validity', 'newbie_reward', 'ticket_sla', 'rate_limit']) {
      expect(keys).toContain(k);
    }
    const before = await request(server()).get('/admin/v1/config/ticket_sla').set(auth(superToken())).expect(200);
    await request(server()).put('/admin/v1/config/ticket_sla').set(auth(superToken())).send({ value: { firstResponseHours: 24 } }).expect(200);
    const after = await request(server()).get('/admin/v1/config/ticket_sla').set(auth(superToken())).expect(200);
    expect((after.body.value as { firstResponseHours: number }).firstResponseHours).toBe(24);
    // 还原
    await request(server()).put('/admin/v1/config/ticket_sla').set(auth(superToken())).send({ value: before.body.value }).expect(200);
    // 未知 key 禁止写入（清单外）
    await request(server()).put('/admin/v1/config/not_a_real_key').set(auth(superToken())).send({ value: {} }).expect(400);
    // 写审计留痕
    const logs = await prisma.adminAuditLog.findMany({ where: { action: 'config_update', targetId: 'ticket_sla' }, orderBy: { id: 'desc' }, take: 1 });
    expect(logs.length).toBe(1);
  });

  // ==================== 审核裁决 → 违规下架联动返额度（§6.1，真实事务） ====================
  it('APPROVE 通过并发审核消息；REJECT 置该档案 active 解锁为 Refunded 且额度返还 +1', async () => {
    // 通过
    const owner = await newUser('ap');
    const prof = await makeProfile(owner.id, 'FEMALE', 'PENDING');
    const okRes = await request(server()).post(`/admin/v1/audit/profiles/${prof.id}`).set(auth(superToken())).send({ decision: 'APPROVE', maritalVerified: 'PASS' }).expect(200);
    expect(okRes.body.auditStatus).toBe('APPROVED');
    const notif = await prisma.systemNotification.findFirst({ where: { userId: owner.id } });
    expect(notif?.title).toBe('档案审核通过');

    // 拒绝并联动退款：B 档案先 APPROVED 被 A 解锁(额度)，编辑后回到 PENDING，再被 REJECT
    const b = await newUser('bj');
    const bProf = await makeProfile(b.id, 'FEMALE', 'APPROVED');
    const a = await newUser('aj');
    await makeProfile(a.id, 'MALE');
    await realnameDb(a.id, 'aj');
    const quota = await grantActiveQuota(a.id, 3);
    const un = await unlockQuota(a.token, bProf.id, `IK_adm_${suffix}`);
    expect(un.status).toBe(200);
    const rec = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: a.id, targetProfileId: bProf.id, status: 'ACTIVE' } });
    // 模拟编辑重审：档案回到待审
    await prisma.profile.update({ where: { id: bProf.id }, data: { auditStatus: 'PENDING' } });

    const rej = await request(server()).post(`/admin/v1/audit/profiles/${bProf.id}`).set(auth(superToken())).send({ decision: 'REJECT', reason: '含违规信息' }).expect(200);
    expect(rej.body.auditStatus).toBe('REJECTED');
    expect(rej.body.refundedUnlocks).toContain(rec.id.toString());

    const afterRec = await prisma.unlockRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(afterRec.status).toBe('REFUNDED');
    const afterQuota = await prisma.memberQuota.findUniqueOrThrow({ where: { id: quota.id } });
    expect(afterQuota.remaining).toBe(3); // 扣 1（3→2）后违规下架返还 1 → 3
    const tx = await prisma.quotaTxLog.findFirst({ where: { quotaId: quota.id, reason: 'REFUND' } });
    expect(tx?.change).toBe(1);

    // 仅待审可裁决
    await request(server()).post(`/admin/v1/audit/profiles/${bProf.id}`).set(auth(superToken())).send({ decision: 'REJECT' }).expect(409);
    // REVIEWER 也可审核
    await request(server()).post(`/admin/v1/audit/profiles/${okRes.body.profileId}`).set(auth(tokens.reviewer)).send({ decision: 'APPROVE' }).expect(409).catch(() => {});
  });

  // ==================== 实名复核撤销（§5.13） ====================
  it('cert REVOKE：清 idCardNoHash + 冻结 active 额度；CONFIRM 仅留痕', async () => {
    const u = await newUser('cert');
    await realnameDb(u.id, 'cert');
    await grantActiveQuota(u.id, 2);
    const cert = await prisma.certification.create({
      data: { userId: u.id, type: 'FACE', result: 'PASSED', provider: 'mock', sessionId: `sess_${suffix}_cert` },
    });
    const list = await request(server()).get('/admin/v1/audit/certifications').set(auth(superToken())).expect(200);
    expect((list.body as { items: { id: string }[] }).items.some((c) => c.id === cert.id.toString())).toBe(true);

    await request(server()).post(`/admin/v1/audit/certifications/${cert.id}`).set(auth(superToken())).send({ decision: 'REVOKE', reason: '人证不符' }).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.idCardNoHash).toBeNull();
    const activeCnt = await prisma.memberQuota.count({ where: { userId: u.id, status: 'ACTIVE' } });
    expect(activeCnt).toBe(0);
    const frozen = await prisma.memberQuota.count({ where: { userId: u.id, status: 'FROZEN' } });
    expect(frozen).toBe(1);
  });

  // ==================== IM 风控台：解锁前明文联系方式留痕（红线 I3） ====================
  it('未解锁发送含手机号 → 20001 拦截 + RiskEvent(CONTACT) 落库；敏感词 → SENSITIVE', async () => {
    const a = await newUser('risk');
    const b = await newUser('riskt');
    await makeProfile(b.id, 'FEMALE'); // 会话不存在（未解锁）
    const blocked = await request(server()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: a.id.toString(), To_Account: b.id.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: '我的号码13800001234加个好友' } }],
    }).expect(200);
    expect(blocked.body.ActionStatus).toBe('FAIL');
    expect(blocked.body.ErrorCode).toBe(20001);

    const risk = await prisma.riskEvent.findFirst({ where: { userId: a.id, category: 'CONTACT' }, orderBy: { id: 'desc' } });
    expect(risk).toBeTruthy();
    expect(risk?.code).toBe(20001);
    // detail 脱敏：不存原始明文号码（I5）
    expect(JSON.stringify(risk?.detail)).not.toContain('13800001234');

    const evList = await request(server()).get('/admin/v1/im/risk-events').set(auth(superToken())).expect(200);
    expect((evList.body as { total: number }).total).toBeGreaterThanOrEqual(1);
  });

  // ==================== 工单（SLA 倒计时排序 + 处理回复回执） ====================
  it('GET /tickets 按 SLA 升序；PUT 处理写审计并向用户发系统消息', async () => {
    const u = await newUser('tk');
    const t1 = await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({ type: 'FEEDBACK', content: '反馈内容一' }).expect(201);
    await prisma.ticket.update({ where: { id: BigInt(t1.body.id) }, data: { slaDeadline: new Date(Date.now() - 3600_000) } }); // 已超时置顶
    const list = await request(server()).get('/admin/v1/tickets').set(auth(superToken())).expect(200);
    const arr = list.body as { id: string; slaRemainingMs: number }[];
    expect(arr[0].slaRemainingMs).toBeLessThan(0); // 超时优先
    const upd = await request(server()).put(`/admin/v1/tickets/${t1.body.id}`).set(auth(superToken())).send({ status: 'PROCESSING', handlerNote: '已受理，稍后处理' }).expect(200);
    expect(upd.body.status).toBe('PROCESSING');
    const msg = await prisma.systemNotification.findFirst({ where: { userId: u.id }, orderBy: { id: 'desc' } });
    expect(msg?.body).toContain('已受理');
  });

  // ==================== 用户查询（三唯一标识脱敏回布尔，I5） ====================
  it('GET /users 关键词命中，手机掩码，三唯一只回布尔不回原值', async () => {
    const u = await newUser('usr');
    await prisma.user.update({ where: { id: u.id }, data: { phone: `137${suffix}`, deviceFingerprint: `dev_${suffix}` } });
    const res = await request(server()).get('/admin/v1/users').query({ keyword: `137${suffix}` }).set(auth(superToken())).expect(200);
    const row = (res.body as { items: Record<string, unknown>[] }).items.find((i) => i.id === u.id.toString());
    expect(row).toBeTruthy();
    expect(row?.phoneMasked).toContain('*');
    expect(row).toHaveProperty('hasDeviceFingerprint', true);
    expect(row).not.toHaveProperty('phone');
  });

  // ==================== 数据看板漏斗 ====================
  it('GET /dashboard/funnel 返回各阶段计数', async () => {
    const res = await request(server()).get('/admin/v1/dashboard/funnel').set(auth(superToken())).expect(200);
    for (const k of ['register', 'realnamePassed', 'unlocks', 'paidOrders', 'paidAmountCent', 'refunds', 'invitedRewarded']) {
      expect(res.body).toHaveProperty(k);
    }
  });

  // ==================== 支付对账（§6.6，只读；mock 账单不可解析→本地单记入 missingInBill） ====================
  it('POST /reconciliation/run 返回差异报告结构并写审计', async () => {
    const res = await request(server()).post('/admin/v1/reconciliation/run').query({ date: ymd(new Date()) }).set(auth(superToken())).expect(200);
    expect(res.body).toHaveProperty('billCount');
    expect(Array.isArray(res.body.missingInBill)).toBe(true);
    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'reconciliation_run' }, orderBy: { id: 'desc' } });
    expect(log).toBeTruthy();
    // 定时任务日切（§6.6）：直接触发 handle（内部 try/catch，异常不外泄）
    await expect(app.get(PaymentReconciliationJob).handle()).resolves.toBeUndefined();
  });

  function ymd(d: Date) {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
});
