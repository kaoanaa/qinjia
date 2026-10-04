import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { UnlockService } from '../src/modules/unlock/unlock.service';

/**
 * Step 12 消息中心 + 我的（PRD §5.12/§5.13，红线 I1）。真实 MySQL，禁 mock 库。
 * Verify：TabBar 角标 = 未读会话数（totalUnread 汇总）；工单提交落库且 SLA 读配置（ticket_sla）。
 * 系统消息触发：实名解冻（reward）、解锁过期清扫（expire，开关可静默）；话术全部来自配置。
 */
describe('消息中心与我的 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let profileSeq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => app.getHttpServer();

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(server()).post('/api/v1/auth/login').send({ code: `M_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_M_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } });
    return { id: user.id, token: login.body.token };
  }

  /** 生僻城市 + 超年龄窗（1950 生）：确保不进入其他 suite 的推荐池，不污染全局档案库 */
  async function makeProfile(ownerUserId: bigint, gender: 'MALE' | 'FEMALE') {
    profileSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `MP${suffix}_${profileSeq}`, ownerUserId, isActive: true,
        relation: 'MOTHER', gender, birthYear: 1950, heightCm: 165,
        education: 'BACHELOR', occupation: '设计师', residenceCity: '日喀则',
        intro: '测试档案', photos: [], isMaritalVerified: true, auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
  }

  async function realnameDb(userId: bigint, tag: string) {
    await prisma.user.update({ where: { id: userId }, data: { idCardNoHash: `mock_hash_direct_${tag}_${suffix}`, phone: `138${suffix}${profileSeq}` } });
  }

  async function grantQuota(userId: bigint) {
    await prisma.memberQuota.create({
      data: { userId, source: 'PAID', total: 3, remaining: 3, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });
  }

  /** 解锁建立会话（详情/会话共用 unlock 语义） */
  async function unlockPair(initiatorToken: string, targetProfileId: bigint, ik: string) {
    await request(server()).post('/api/v1/unlock').set(auth(initiatorToken)).set('Idempotency-Key', ik).send({ profileId: targetProfileId.toString() }).expect(200);
  }

  async function sendText(fromId: bigint, toId: bigint, text: string) {
    const res = await request(server()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: fromId.toString(), To_Account: toId.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: text } }],
    }).expect(200);
    expect(res.body.ActionStatus).toBe('OK');
  }

  /** 完整 HTTP 实名流程（OCR→face），触发解冻 + reward 系统消息 */
  async function realnameFlow(token: string, key: string) {
    const ocr = await request(server()).post('/api/v1/cert/idcard-ocr').set(auth(token)).send({ objectKey: key }).expect(200);
    const init = await request(server()).post('/api/v1/cert/face-init').set(auth(token)).send({ certId: ocr.body.certId }).expect(200);
    await request(server()).post('/api/v1/cert/face-verify').set(auth(token)).send({ sessionId: init.body.sessionId }).expect(200);
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

  // ==================== 角标：TabBar 未读数 = 未读消息所在会话之和（Step 12 Verify） ====================
  it('会话未读：unreadCount/totalUnread 精确；:id/read 清零且不影响对方', async () => {
    const a = await newUser('a');
    await realnameDb(a.id, 'a');
    await makeProfile(a.id, 'MALE');
    await grantQuota(a.id);
    const b = await newUser('b');
    await makeProfile(b.id, 'FEMALE');

    await unlockPair(a.token, (await prisma.profile.findFirstOrThrow({ where: { ownerUserId: b.id } })).id, `IK_misc_${suffix}`);
    await sendText(a.id, b.id, '你好，孩子的事聊聊');
    await sendText(b.id, a.id, '好的');
    await sendText(a.id, b.id, '方便电话吗');

    const listB = await request(server()).get('/api/v1/conversations').set(auth(b.token)).expect(200);
    const convB = listB.body.items.find((i: { counterpart: { matchNo: string } }) => i.counterpart.nickname);
    expect(convB).toBeTruthy();
    // B 视角：A 发来 2 条未读；A 视角：B 发来 1 条未读
    expect(convB.unreadCount).toBe(2);
    expect(listB.body.totalUnread).toBe(2);
    // 分页不影响 totalUnread（全量汇总）
    const paged = await request(server()).get('/api/v1/conversations?page=1&size=1').set(auth(b.token)).expect(200);
    expect(paged.body.totalUnread).toBe(2);

    const readRes = await request(server()).post(`/api/v1/conversations/${convB.id}/read`).set(auth(b.token)).expect(200);
    expect(readRes.body.unreadCount).toBe(0);
    const listB2 = await request(server()).get('/api/v1/conversations').set(auth(b.token)).expect(200);
    expect(listB2.body.items.find((i: { id: string }) => i.id === convB.id).unreadCount).toBe(0);
    expect(listB2.body.totalUnread).toBe(0);
    // 已读只清「对方发来」的；B 自己发出的消息不标已读（A 仍看到 2 条未读）
    const listA = await request(server()).get('/api/v1/conversations').set(auth(a.token)).expect(200);
    expect(listA.body.totalUnread).toBe(1);

    await request(server()).post('/api/v1/conversations/999999999999/read').set(auth(b.token)).expect(404);
    await request(server()).post('/api/v1/conversations/abc/read').set(auth(b.token)).expect(400);
  });

  // ==================== 系统消息：实名解冻触发 reward 模板（话术读配置，I1） ====================
  it('实名通过 → reward 系统消息；列表/未读数/全部已读', async () => {
    const c = await newUser('c');
    await prisma.memberQuota.create({
      data: { userId: c.id, source: 'NEWBIE', total: 10, remaining: 10, status: 'FROZEN', expireAt: new Date(Date.now() + 7 * 864e5) },
    }); // frozen 批次：face 通过 → 解冻 → reward 系统消息
    await realnameFlow(c.token, `id_card/ocr_c_${suffix}`);

    const list = await request(server()).get('/api/v1/notifications').set(auth(c.token)).expect(200);
    const reward = list.body.items.find((n: { category: string }) => n.category === 'reward');
    expect(reward).toBeTruthy();
    expect(reward.title).toBe('实名审核通过'); // 与 seed copywriting.notifyTemplates 一致
    expect(reward.readFlag).toBe(false);
    expect(list.body.unread).toBeGreaterThanOrEqual(1);

    const read = await request(server()).post('/api/v1/notifications/read-all').set(auth(c.token)).expect(200);
    expect(read.body.updated).toBe(list.body.unread);
    const list2 = await request(server()).get('/api/v1/notifications').set(auth(c.token)).expect(200);
    expect(list2.body.unread).toBe(0);
  });

  // ==================== 系统消息：解锁过期触发 expire；expireRemind=false 静默 ====================
  it('解锁过期清扫 → expire 系统消息；关闭 expireRemind 不发', async () => {
    // 对：A→D 解锁（正常收到 expire）
    const a = await newUser('a2');
    await realnameDb(a.id, 'a2');
    await makeProfile(a.id, 'MALE');
    await grantQuota(a.id);
    const d = await newUser('d');
    await makeProfile(d.id, 'FEMALE');
    const dProf = await prisma.profile.findFirstOrThrow({ where: { ownerUserId: d.id } });
    await unlockPair(a.token, dProf.id, `IK_misc2_${suffix}`);
    await prisma.unlockRecord.updateMany({ where: { initiatorUserId: a.id }, data: { expireAt: new Date(Date.now() - 1000) } });

    // 对：E→D 解锁 + 关闭 expireRemind（应静默）
    const e = await newUser('e2');
    await realnameDb(e.id, 'e2');
    await makeProfile(e.id, 'MALE');
    await grantQuota(e.id);
    await unlockPair(e.token, dProf.id, `IK_misc3_${suffix}`);
    await prisma.unlockRecord.updateMany({ where: { initiatorUserId: e.id }, data: { expireAt: new Date(Date.now() - 1000) } });
    await prisma.notifyPref.create({ data: { userId: e.id, switches: { expireRemind: false } } });

    await app.get(UnlockService).expireOverdue();

    const listA = await request(server()).get('/api/v1/notifications').set(auth(a.token)).expect(200);
    const exp = listA.body.items.find((n: { category: string }) => n.category === 'expire');
    expect(exp.title).toBe('解锁已到期');

    const listE = await request(server()).get('/api/v1/notifications').set(auth(e.token)).expect(200);
    expect(listE.body.items.some((n: { category: string }) => n.category === 'expire')).toBe(false);
  });

  // ==================== 工单：提交落库，SLA 读 ticket_sla 配置（Step 12 Verify，I1） ====================
  it('POST /tickets 落库 + slaDeadline=+48h（配置）；GET 我的工单；校验 400', async () => {
    const u = await newUser('tk');
    const res = await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({
      type: 'FEEDBACK', content: '支付成功但额度没到账', images: ['tickets/ev_1.jpg'],
    }).expect(201);
    expect(res.body.status).toBe('OPEN');
    const slaCfg = await prisma.rewardConfig.findFirstOrThrow({ where: { configKey: 'ticket_sla' } });
    const hours = (slaCfg.value as { firstResponseHours: number }).firstResponseHours;
    const gapH = (new Date(res.body.slaDeadline).getTime() - new Date(res.body.createdAt).getTime()) / 3600_000;
    expect(Math.abs(gapH - hours)).toBeLessThan(0.1); // 时长来自配置而非写死

    const refund = await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({
      type: 'REFUND', content: '要求退款', orderId: '123',
    }).expect(201);
    expect(refund.body.type).toBe('REFUND');

    const mine = await request(server()).get('/api/v1/tickets').set(auth(u.token)).expect(200);
    expect(mine.body).toHaveLength(2);
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(refund.body.id);

    const dbRow = await prisma.ticket.findUniqueOrThrow({ where: { id: BigInt(res.body.id) } });
    expect(dbRow.userId).toBe(u.id); // 落库校验

    await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({ type: 'BOGUS', content: 'x' }).expect(400);
    await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({ type: 'FEEDBACK', content: '' }).expect(400);
    await request(server()).post('/api/v1/tickets').set(auth(u.token)).send({ type: 'FEEDBACK', content: 'x', orderId: 'abc' }).expect(400);
  });

  // ==================== 通知设置（我的页开关）：默认值/合并更新/内部 im 键透传 ====================
  it('settings/notify：默认全开 UNKNOWN；PUT 部分合并持久化；switches.im 透传', async () => {
    const u = await newUser('ns');
    const def = await request(server()).get('/api/v1/settings/notify').set(auth(u.token)).expect(200);
    expect(def.body).toEqual({ switches: { review: true, expireRemind: true, activity: true, rewardArrived: true }, subscribeAuthStatus: 'UNKNOWN' });

    const upd = await request(server()).put('/api/v1/settings/notify').set(auth(u.token)).send({
      switches: { activity: false, im: false }, subscribeAuthStatus: 'GRANTED',
    }).expect(200);
    expect(upd.body.switches).toMatchObject({ review: true, activity: false, im: false });
    expect(upd.body.subscribeAuthStatus).toBe('GRANTED');

    const again = await request(server()).put('/api/v1/settings/notify').set(auth(u.token)).send({ switches: { review: false } }).expect(200);
    expect(again.body.switches).toMatchObject({ review: false, activity: false, im: false }); // 合并语义：旧键保留
    expect(again.body.subscribeAuthStatus).toBe('GRANTED');

    const got = await request(server()).get('/api/v1/settings/notify').set(auth(u.token)).expect(200);
    expect(got.body.switches.im).toBe(false);

    await request(server()).put('/api/v1/settings/notify').set(auth(u.token)).send({ subscribeAuthStatus: 'NOPE' }).expect(400);
  });

  // ==================== 运营位：防诈指南 Banner（契约 security:[] 未登录可见） ====================
  it('ops/slots：未登录可取 BANNER 防诈指南；type 过滤；非法 type 400', async () => {
    const all = await request(server()).get('/api/v1/ops/slots').expect(200);
    const banner = all.body.find((s: { type: string }) => s.type === 'BANNER');
    expect(banner).toBeTruthy();
    expect((banner.content as { text: string }).text).toContain('诈骗');

    const onlyBanner = await request(server()).get('/api/v1/ops/slots?type=BANNER').expect(200);
    expect(onlyBanner.body.every((s: { type: string }) => s.type === 'BANNER')).toBe(true);
    // seed 的 TAB_CENTER 占位 enabled:false → 不出现在结果中
    const popup = await request(server()).get('/api/v1/ops/slots?type=POPUP').expect(200);
    expect(popup.body).toHaveLength(0);

    await request(server()).get('/api/v1/ops/slots?type=BOGUS').expect(400);
  });

  // ==================== P2 占位 stub（D8/Step 18：直播/本地群不开发） ====================
  it('P2 占位：live/widget 与 local-groups 免登录恒 available=false，话术读 copywriting 配置（红线 I1）', async () => {
    const live = await request(server()).get('/api/v1/live/widget').expect(200);
    expect(live.body.available).toBe(false);
    expect(live.body.tip).toContain('敬请期待');

    const groups = await request(server()).get('/api/v1/local-groups').expect(200);
    expect(groups.body.available).toBe(false);
    expect(groups.body.tip).toContain('敬请期待');
  });
});
