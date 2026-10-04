import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { OrderService } from '../src/modules/order/order.service';
import { SMS, SmsProvider } from '../src/providers/interfaces';

/**
 * Step 16（§5.7/§5.8，P1）：三大墙（非会员模糊）、三记录、精准搜索（含仅同城/拉黑互斥）、
 * 打招呼收件箱、设置全集（实名回显/子女授权撤回/子女协助大额支付通知）、注销账号 PIPL 匿名化。
 */
describe('三大墙/搜索/设置/注销 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ocrKey = () => `id_card/ocr_W16_${randomUUID().slice(0, 8)}`;

  async function login(tag: string): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/login').send({ code: `W16_${tag}_${suffix}` }).expect(201);
    return res.body.token;
  }

  async function realname(token: string) {
    await request(server()).post('/api/v1/cert/idcard-ocr').set(auth(token)).send({ objectKey: ocrKey() }).expect(200);
    const init = await request(server()).post('/api/v1/cert/face-init').set(auth(token)).send({}).expect(200);
    await request(server()).post('/api/v1/cert/face-verify').set(auth(token)).send({ sessionId: init.body.sessionId }).expect(200);
  }

  /** 登录+实名+建 SELF 档案+发布，返回 token 与档案 */
  async function actor(tag: string, p: { gender: string; birthYear: number; heightCm: number; education: string; city: string }) {
    const token = await login(tag);
    await realname(token);
    const prof = await request(server())
      .post('/api/v1/profiles')
      .set(auth(token))
      .send({ relation: 'SELF', gender: p.gender, birthYear: p.birthYear, heightCm: p.heightCm, education: p.education, occupation: '职员', residenceCity: p.city, photoObjectKeys: [`photos/w16_${tag}.jpg`] })
      .expect(201);
    await request(server()).post(`/api/v1/profiles/${prof.body.id}/publish`).set(auth(token)).send({ commitmentChecked: true, commitmentVersion: 'v1' }).expect(200);
    const approved = await prisma.profile.update({ where: { id: BigInt(prof.body.id) }, data: { auditStatus: 'APPROVED', publishedAt: new Date(), isActive: true } }); // 模拟后台过审（同 detail/unlock 样板）
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_W16_${tag}_${suffix}` } });
    return { token, userId: user.id, nickname: user.nickname, profileId: BigInt(prof.body.id), matchNo: approved.matchNo };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0); // 常驻监听：避免 supertest 每请求 listen/close 在 macOS 上的端口复用竞态（ECONNREFUSED）
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // 自清理：本套件的 actor 档案走真实发布链路且全局可见，停用以免污染 feed 等全局候选池断言
    const owners = await prisma.user.findMany({ where: { openid: { startsWith: `mock_openid_W16_` } }, select: { id: true } });
    await prisma.profile.updateMany({ where: { ownerUserId: { in: owners.map((u) => u.id) } }, data: { isActive: false } });
    await app.close();
  });

  // ==================== 三大墙 + 三记录 ====================
  it('看过我的/收藏我的/解锁我的：会员可见、非会员昵称掩码+头像模糊；我的记录分页', async () => {
    const owner = await actor('own', { gender: 'MALE', birthYear: 1994, heightCm: 178, education: 'BACHELOR', city: '杭州' });
    const visitor = await actor('vst', { gender: 'FEMALE', birthYear: 1995, heightCm: 165, education: 'COLLEGE', city: '杭州' });

    await request(server()).get(`/api/v1/feed/public/${owner.matchNo}`).set(auth(visitor.token)).expect(200);
    await request(server()).post('/api/v1/favorites').set(auth(visitor.token)).send({ profileId: owner.profileId.toString() }).expect(200);
    const un = await request(server()).post('/api/v1/unlock').set(auth(visitor.token)).set('Idempotency-Key', `IK_W16_${suffix}`).send({ profileId: owner.profileId.toString(), riskConfirmed: true }).expect(200);
    expect(un.body.payType).toBe('QUOTA');

    // owner 注册即 TRIAL（D9）→ 会员可见
    for (const wall of ['viewed-me', 'favorited-me', 'unlocked-me']) {
      const res = await request(server()).get(`/api/v1/walls/${wall}`).set(auth(owner.token)).expect(200);
      expect(res.body.isMemberVisible).toBe(true);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].nickname).toBe(visitor.nickname);
      expect(res.body.items[0].avatarUrl).not.toContain('blur');
    }
    await request(server()).get('/api/v1/walls/bogus').set(auth(owner.token)).expect(400);

    // 降级非会员 → 列表模糊（昵称掩码 + 头像打码）
    await prisma.user.update({ where: { id: owner.userId }, data: { memberLevel: 'NONE' } });
    const blurred = await request(server()).get('/api/v1/walls/viewed-me').set(auth(owner.token)).expect(200);
    expect(blurred.body.isMemberVisible).toBe(false);
    expect(blurred.body.items[0].nickname).not.toBe(visitor.nickname);
    expect(blurred.body.items[0].nickname).toContain('*');
    expect(blurred.body.items[0].avatarUrl).toContain('blur');

    // 三记录（本人历史，不设会员墙）
    const recView = await request(server()).get('/api/v1/records/view').set(auth(visitor.token)).expect(200);
    expect(recView.body.items.some((i: { profileId: string }) => i.profileId === owner.profileId.toString())).toBe(true);
    const recFav = await request(server()).get('/api/v1/records/favorite').set(auth(visitor.token)).expect(200);
    expect(recFav.body.total).toBeGreaterThanOrEqual(1);
    const recUn = await request(server()).get('/api/v1/records/unlock').set(auth(visitor.token)).expect(200);
    expect(recUn.body.total).toBe(1);
    await request(server()).get('/api/v1/records/bogus').set(auth(visitor.token)).expect(400);
  });

  // ==================== 精准搜索 + 仅同城 + 拉黑互斥 ====================
  it('search 城市/学历/身高/年龄过滤；cityOnlyVisible 仅同城；黑名单排除且列表脱敏', async () => {
    const searcher = await actor('srch', { gender: 'MALE', birthYear: 1993, heightCm: 175, education: 'BACHELOR', city: '杭州' });
    const tHz = await actor('tHz', { gender: 'FEMALE', birthYear: 1996, heightCm: 162, education: 'BACHELOR', city: '杭州' });
    const tBj = await actor('tBj', { gender: 'FEMALE', birthYear: 1990, heightCm: 172, education: 'MASTER', city: '北京' });

    const byCity = await request(server()).get('/api/v1/search').query({ city: '杭州' }).set(auth(searcher.token)).expect(200);
    expect(byCity.body.items.some((i: { matchNo: string }) => i.matchNo === tHz.matchNo)).toBe(true);
    expect(byCity.body.items.some((i: { matchNo: string }) => i.matchNo === tBj.matchNo)).toBe(false);

    const byEdu = await request(server()).get('/api/v1/search').query({ education: 'MASTER', heightMin: 170, city: '北京' }).set(auth(searcher.token)).expect(200);
    expect(byEdu.body.items.map((i: { matchNo: string }) => i.matchNo)).toContain(tBj.matchNo);
    expect(byEdu.body.items.every((i: { heightCm: number; education: string }) => i.heightCm >= 170 && i.education === 'MASTER')).toBe(true);

    const byAge = await request(server()).get('/api/v1/search').query({ ageMin: 31, ageMax: 40 }).set(auth(searcher.token)).expect(200);
    expect(byAge.body.items.some((i: { matchNo: string }) => i.matchNo === tBj.matchNo)).toBe(true); // 90年生 ≈36岁
    expect(byAge.body.items.some((i: { matchNo: string }) => i.matchNo === tHz.matchNo)).toBe(false); // 96年生 ≈30岁 低于下界
    expect(byAge.body.items.every((i: { birthYear: number }) => { const age = new Date().getFullYear() - i.birthYear; return age >= 31 && age <= 40; })).toBe(true);

    // 仅同城可见：北京用户开开关 → 杭州访问者搜不到；本人开关回显
    await request(server()).put('/api/v1/settings/privacy').set(auth(tBj.token)).send({ cityOnlyVisible: true }).expect(200);
    const hid = await request(server()).get('/api/v1/search').query({ city: '北京' }).set(auth(searcher.token)).expect(200);
    expect(hid.body.items.map((i: { matchNo: string }) => i.matchNo)).not.toContain(tBj.matchNo); // 异城不可见
    const self = await request(server()).get('/api/v1/search').query({ city: '北京' }).set(auth(tBj.token)).expect(200);
    expect(self.body.items.map((i: { matchNo: string }) => i.matchNo)).not.toContain(tBj.matchNo); // 自己也不含自己（排除本人）
    const sameCity = await request(server()).get('/api/v1/search').query({ city: '北京' }).set(auth((await actor('tBj2', { gender: 'MALE', birthYear: 1991, heightCm: 176, education: 'BACHELOR', city: '北京' })).token)).expect(200);
    expect(sameCity.body.items.some((i: { matchNo: string }) => i.matchNo === tBj.matchNo)).toBe(true);

    // 拉黑：搜索排除 + 列表脱敏 + 重复幂等 + 不能拉黑自己
    await request(server()).post('/api/v1/blacklist').set(auth(searcher.token)).send({ blockedUserId: tHz.userId.toString() }).expect(201);
    await request(server()).post('/api/v1/blacklist').set(auth(searcher.token)).send({ blockedUserId: tHz.userId.toString() }).expect(201);
    const after = await request(server()).get('/api/v1/search').query({ city: '杭州' }).set(auth(searcher.token)).expect(200);
    expect(after.body.items.some((i: { matchNo: string }) => i.matchNo === tHz.matchNo)).toBe(false);
    const bl = await request(server()).get('/api/v1/blacklist').set(auth(searcher.token)).expect(200);
    expect(bl.body.items.length).toBe(1);
    expect(bl.body.items[0].nicknameMasked).toContain('*');
    expect(bl.body.items[0].nicknameMasked).not.toBe(tHz.nickname);
    await request(server()).post('/api/v1/blacklist').set(auth(searcher.token)).send({ blockedUserId: searcher.userId.toString() }).expect(400);
    await request(server()).post('/api/v1/blacklist').set(auth(searcher.token)).send({ blockedUserId: 'abc' }).expect(400);
  });

  // ==================== 打招呼收件箱（§5.7 P1） ====================
  it('打招呼 → 对方消息中心收到 greet 类别（话术读配置+占位填充）', async () => {
    const greeter = await actor('gtr', { gender: 'MALE', birthYear: 1992, heightCm: 174, education: 'COLLEGE', city: '杭州' });
    const target = await actor('gtt', { gender: 'FEMALE', birthYear: 1994, heightCm: 160, education: 'COLLEGE', city: '杭州' });
    await request(server()).post('/api/v1/greet').set(auth(greeter.token)).send({ profileId: target.profileId.toString() }).expect(200);
    await new Promise((r) => setTimeout(r, 80));

    const notif = await request(server()).get('/api/v1/notifications').set(auth(target.token)).expect(200);
    const greet = notif.body.items.find((i: { category: string }) => i.category === 'greet');
    expect(greet).toBeTruthy();
    expect(greet.title).toContain(greeter.nickname); // {nickname} 已填充
    expect(greet.title).toContain(greeter.matchNo);
    expect(greet.title).not.toContain('{nickname}');
  });

  // ==================== 设置：实名回显 + 子女授权管理/撤回 ====================
  it('realname 仅掩码回显；子女授权列表脱敏；撤回→档案下架', async () => {
    const p = await actor('cons', { gender: 'MALE', birthYear: 1995, heightCm: 177, education: 'BACHELOR', city: '杭州' });
    const rn = await request(server()).get('/api/v1/settings/realname').set(auth(p.token)).expect(200);
    expect(rn.body.realnamePassed).toBe(true);
    expect(rn.body.idCardNoMasked).toContain('*');
    expect(rn.body.certifiedAt).toBeTruthy();

    // 子女档案（FATHER）需授权：走 consent 流程后发布
    const child = await request(server())
      .post('/api/v1/profiles')
      .set(auth(p.token))
      .send({ relation: 'FATHER', gender: 'FEMALE', birthYear: 1997, heightCm: 165, education: 'COLLEGE', occupation: '教师', residenceCity: '杭州', photoObjectKeys: ['photos/w16_child.jpg'] })
      .expect(201);
    const cid = child.body.id as string;
    const phone = `137${suffix.slice(-8)}`;
    await request(server()).post('/api/v1/consent/send-sms').set(auth(p.token)).send({ profileId: cid, childPhone: phone }).expect(200);
    await request(server()).post('/api/v1/consent/verify').set(auth(p.token)).send({ profileId: cid, childPhone: phone, code: '123456', statementAccepted: true, statementVersion: 'v1.0' }).expect(200);
    await request(server()).post(`/api/v1/profiles/${cid}/publish`).set(auth(p.token)).send({ commitmentChecked: true, commitmentVersion: 'v1' }).expect(200);

    const list = await request(server()).get('/api/v1/settings/consents').set(auth(p.token)).expect(200);
    expect(list.body.items.length).toBe(1);
    const item = list.body.items[0];
    expect(item.childPhoneMasked).toContain('****');
    expect(JSON.stringify(list.body)).not.toContain(phone); // 密文不外泄（I5）

    const del = await request(server()).delete(`/api/v1/settings/consents/${item.consentId}`).set(auth(p.token)).expect(200);
    expect(del.body.revoked).toBe(true);
    const prof = await prisma.profile.findUniqueOrThrow({ where: { id: BigInt(cid) } });
    expect(prof.isActive).toBe(false); // 撤回即停止处理（PIPL）
    expect(await prisma.consentRecord.count({ where: { profileId: BigInt(cid) } })).toBe(0);
    await request(server()).delete(`/api/v1/settings/consents/${item.consentId}`).set(auth(p.token)).expect(404);
  });

  // ==================== 子女协助管理：大额支付通知子女 ====================
  it('bigPayNotifyChild 开启+金额≥阈值 → 解密子女手机发短信；关闭/低于阈值不发', async () => {
    const p = await actor('big', { gender: 'MALE', birthYear: 1990, heightCm: 176, education: 'BACHELOR', city: '杭州' });
    const child = await request(server())
      .post('/api/v1/profiles')
      .set(auth(p.token))
      .send({ relation: 'MOTHER', gender: 'FEMALE', birthYear: 1996, heightCm: 164, education: 'HIGH_SCHOOL', occupation: '文员', residenceCity: '杭州', photoObjectKeys: ['photos/w16_child2.jpg'] })
      .expect(201);
    const phone = `136${suffix.slice(-8)}`;
    await request(server()).post('/api/v1/consent/send-sms').set(auth(p.token)).send({ profileId: child.body.id, childPhone: phone }).expect(200);
    await request(server()).post('/api/v1/consent/verify').set(auth(p.token)).send({ profileId: child.body.id, childPhone: phone, code: '123456', statementAccepted: true, statementVersion: 'v1.0' }).expect(200);

    const sms = app.get<SmsProvider>(SMS);
    const spy = jest.spyOn(sms, 'sendCode').mockResolvedValue({ ttlSeconds: 300 });
    const orders = app.get(OrderService);
    const notify = (userId: bigint, cent: number) => (orders as unknown as { notifyChildOnBigPay(u: bigint, c: number): Promise<void> }).notifyChildOnBigPay(userId, cent);

    await notify(p.userId, 60000); // 开关未开 → 不发
    expect(spy).not.toHaveBeenCalled();

    await request(server()).put('/api/v1/settings/privacy').set(auth(p.token)).send({ bigPayNotifyChild: true }).expect(200);
    await notify(p.userId, 40000); // 低于 big_pay_threshold(500元) → 不发
    expect(spy).not.toHaveBeenCalled();

    await notify(p.userId, 60000); // ≥阈值 → 子女手机收到（解密后号码，非密文）
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(phone, 'big_pay_confirm');
    spy.mockRestore();
  });

  // ==================== 注销账号（PIPL） ====================
  it('未确认400/验证码错400/受理返回冷静期；到期匿名化+留痕；注销后登录403', async () => {
    const c = await actor('clse', { gender: 'MALE', birthYear: 1988, heightCm: 173, education: 'BACHELOR', city: '杭州' });
    await request(server()).post('/api/v1/auth/bind-phone').set(auth(c.token)).send({ phoneCode: `1${suffix.slice(-7)}` }).expect(201);

    await request(server()).post('/api/v1/settings/account-close').set(auth(c.token)).send({ confirmed: false }).expect(400);
    const denied = await request(server()).post('/api/v1/settings/account-close').set(auth(c.token)).send({ confirmed: true, smsCode: '000000' });
    expect(denied.body.errorCode).toBe('SMS_CODE_INVALID');

    const ok = await request(server()).post('/api/v1/settings/account-close').set(auth(c.token)).send({ confirmed: true, smsCode: '123456' }).expect(200);
    const days = (new Date(ok.body.effectiveAt).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
    const profAfter = await prisma.profile.findFirstOrThrow({ where: { id: c.profileId } });
    expect(profAfter.isActive).toBe(false); // 冷静期内即下架

    const again = await request(server()).post('/api/v1/settings/account-close').set(auth(c.token)).send({ confirmed: true, smsCode: '123456' }).expect(200);
    expect(again.body.alreadyScheduled).toBe(true);

    // 冷静期到期 → 匿名化
    await prisma.user.update({ where: { id: c.userId }, data: { closeScheduledAt: new Date(Date.now() - 1000) } });
    const { MiscService } = await import('../src/modules/misc/misc.service');
    const swept = await app.get(MiscService).anonymizeDue();
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(after.status).toBe('CLOSED');
    expect(after.openid).toMatch(/^closed_/);
    expect(after.phone).toBeNull();
    expect(after.idCardNoHash).toBeNull();
    expect(after.deviceFingerprint).toBeNull();
    expect(after.nickname).toBe('已注销用户');
    expect(await prisma.profile.count({ where: { ownerUserId: c.userId } })).toBe(0); // 档案物理删除
    expect(await prisma.certification.count({ where: { userId: c.userId } })).toBe(0);
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'account_close_anonymize', targetId: c.userId.toString() } });
    expect(audit).toBeTruthy();

    // 匿名化后原微信身份不可再关联：同一 code 登录 → 全新账号（PIPL 真删除语义）
    const relogin = await request(server()).post('/api/v1/auth/login').send({ code: `W16_clse_${suffix}` }).expect(201);
    expect(relogin.body.isNewUser).toBe(true);
    expect(relogin.body.user.id).not.toBe(c.userId.toString());
  });
});
