import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigKeys } from '@qinjia/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CONFIG_CENTER, ConfigCenter, IM, ImProvider, WECHAT_AUTH, WechatAuth } from '../src/providers/interfaces';

/**
 * Step 10 IM 集成与聊天室（PRD §5.6，红线 I3 服务端裁决）。真实 MySQL，禁 mock 库。
 * 覆盖：未解锁 callback 拒绝 / 解锁前明文联系方式拦截 / 用例2延伸双向互发 /
 * 过期禁发 / 敏感词 / 接触升级三动作留痕 / UserSig / 订阅消息模板 ID 走 im_config（Exit）。
 */
describe('IM 回调与聊天室 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let im: ImProvider;
  let wechat: WechatAuth;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let phoneSeq = 0;
  let profileSeq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `C_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_C_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } }); // 隔离注册赠礼
    return { id: user.id, token: login.body.token };
  }

  async function realname(userId: bigint, tag: string) {
    phoneSeq += 1;
    await prisma.user.update({
      where: { id: userId },
      data: { idCardNoHash: `mock_hash_${tag}_${suffix}`, phone: `139${suffix}${phoneSeq}` },
    });
  }

  async function makeProfile(ownerUserId: bigint, photos: unknown[] = []) {
    profileSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `MC${suffix}_${profileSeq}`, ownerUserId, isActive: true,
        relation: 'MOTHER', gender: 'FEMALE', birthYear: 1995, heightCm: 165,
        education: 'BACHELOR', occupation: '设计师', residenceCity: '杭州', photos,
        isMaritalVerified: true, auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
  }

  async function grantQuota(userId: bigint, remaining: number) {
    return prisma.memberQuota.create({
      data: { userId, source: 'PAID', total: remaining, remaining, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });
  }

  /** 已实名+已建档的一对用户；A 初始有额度可解锁 B */
  async function pair(tag: string) {
    const a = await newUser(`a_${tag}`);
    await realname(a.id, `a_${tag}`);
    const ap = await makeProfile(a.id);
    const b = await newUser(`b_${tag}`);
    await realname(b.id, `b_${tag}`);
    const bp = await makeProfile(b.id);
    await grantQuota(a.id, 3);
    return { a, ap, b, bp };
  }

  const send = (from: bigint, to: bigint, text: string) =>
    request(app.getHttpServer()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg',
      From_Account: from.toString(),
      To_Account: to.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: text } }],
    });

  async function unlock(a: { id: bigint; token: string }, bProfileId: bigint, ik: string) {
    return request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(a.token)).set('Idempotency-Key', ik)
      .send({ profileId: bProfileId.toString() })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    im = app.get(IM);
    wechat = app.get(WECHAT_AUTH);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 未解锁：服务端裁决拒绝（前端隐藏不算数，I3） ====================
  it('未解锁发消息 FAIL 20002；解锁前含手机号/微信号明文 FAIL 20001；非本系统账号/非发送回调放行', async () => {
    const { a, b } = await pair('lock');

    const blocked = await send(a.id, b.id, '你好').expect(200);
    expect(blocked.body).toMatchObject({ ActionStatus: 'FAIL', ErrorCode: 20002 });
    expect(blocked.body.ErrorInfo).toContain('解锁');

    const phoneLeak = await send(a.id, b.id, '我的手机13812345678加我').expect(200);
    expect(phoneLeak.body).toMatchObject({ ActionStatus: 'FAIL', ErrorCode: 20001 });
    expect(phoneLeak.body.ErrorInfo).toContain('联系方式');

    const wxLeak = await send(a.id, b.id, '加我微信号 dasouche2024').expect(200);
    expect(wxLeak.body.ErrorCode).toBe(20001);

    const alien = await request(app.getHttpServer()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: 'third_party', To_Account: 'x', MsgBody: [],
    }).expect(200);
    expect(alien.body.ActionStatus).toBe('OK');

    const other = await request(app.getHttpServer()).post('/api/v1/im/callback').send({ CallbackCommand: 'AfterSendMsg' }).expect(200);
    expect(other.body.ActionStatus).toBe('OK');
  });

  // ==================== 用例 2 延伸：解锁后双向互发 + 镜像 + UserSig + addFriend ====================
  it('解锁后 A↔B 双向 callback OK；镜像 Message + lastMsgDigest；UserSig 读 im_config；开会话触发 addFriend', async () => {
    const { a, b, bp } = await pair('both');
    const addFriend = jest.spyOn(im, 'addFriend').mockResolvedValue(undefined);

    const r = await unlock(a, bp.id, `IK_both_${suffix}`);
    expect(r.body.conversation.canSend).toBe(true);
    await new Promise((res) => setTimeout(res, 50)); // addFriend 为 fire-and-forget
    expect(addFriend).toHaveBeenCalledTimes(1);
    addFriend.mockRestore();

    const ab = await send(a.id, b.id, '你好，亲家').expect(200);
    expect(ab.body.ActionStatus).toBe('OK');
    const ba = await send(b.id, a.id, '在的，孩子多大了').expect(200); // 被动方双向可聊 D12
    expect(ba.body.ActionStatus).toBe('OK');

    const self = await send(a.id, a.id, 'hi').expect(200);
    expect(self.body).toMatchObject({ ActionStatus: 'FAIL', ErrorCode: 20004 });

    const conv = await prisma.conversation.findFirstOrThrow({ where: { unlockRecordId: BigInt(r.body.unlockId) } });
    const msgs = await prisma.message.findMany({ where: { convId: conv.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.content)).toEqual(['你好，亲家', '在的，孩子多大了']);
    expect(conv.lastMsgDigest).toBe('在的，孩子多大了');

    const convs = await request(app.getHttpServer()).get('/api/v1/conversations').set(auth(a.token)).expect(200);
    expect(convs.body.total).toBe(1);
    expect(convs.body.items[0]).toMatchObject({ canSend: true, lastMsgDigest: '在的，孩子多大了' });
    expect(convs.body.items[0].counterpart.childDigest).toContain('女·95年·杭州·165cm·本科·设计师');

    const sig = await request(app.getHttpServer()).get('/api/v1/im/user-sig').set(auth(a.token)).expect(200);
    expect(sig.body).toEqual({ sdkAppId: 'MOCK_IM_SDK_1400000000', userSig: `mock_sig_${a.id}` });
  });

  // ==================== 敏感词 + 图片消息 ====================
  it('敏感词 FAIL 20003；纯图片消息放行并镜像为 [图片]', async () => {
    const { a, b, bp } = await pair('sens');
    await unlock(a, bp.id, `IK_sens_${suffix}`);

    const hit = await send(a.id, b.id, '先转账看看诚意').expect(200);
    expect(hit.body).toMatchObject({ ActionStatus: 'FAIL', ErrorCode: 20003 });

    const img = await request(app.getHttpServer()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: a.id.toString(), To_Account: b.id.toString(),
      MsgBody: [{ MsgType: 'TIMImageElem', MsgContent: {} }],
    }).expect(200);
    expect(img.body.ActionStatus).toBe('OK');

    const conv = await prisma.conversation.findFirstOrThrow({ where: { userA: a.id < b.id ? a.id : b.id, userB: a.id < b.id ? b.id : a.id } });
    const last = await prisma.message.findFirstOrThrow({ where: { convId: conv.id }, orderBy: { createdAt: 'desc' } });
    expect(last).toMatchObject({ type: 'IMAGE', content: '[图片]' });
  });

  // ==================== 过期：清扫任务 + forbidSend + 禁发话术 + 重解锁恢复 ====================
  it('过期后 callback FAIL（已过期话术）；定时任务置 EXPIRED 并 forbidSend；重新解锁恢复可发', async () => {
    const { a, b, bp } = await pair('exp');
    const r = await unlock(a, bp.id, `IK_exp_${suffix}`);
    const id1 = BigInt(r.body.unlockId);
    await prisma.unlockRecord.update({ where: { id: id1 }, data: { expireAt: new Date(Date.now() - 1000) } });

    const forbid = jest.spyOn(im, 'forbidSend').mockResolvedValue(undefined);
    const { UnlockExpiryJob } = await import('../src/modules/unlock/unlock-expiry.job');
    await app.get(UnlockExpiryJob).handle();
    expect(forbid).toHaveBeenCalled();
    forbid.mockRestore();

    const blocked = await send(a.id, b.id, '还在吗').expect(200);
    expect(blocked.body).toMatchObject({ ActionStatus: 'FAIL', ErrorCode: 20002 });
    expect(blocked.body.ErrorInfo).toContain('过期');

    // 会话历史保留；列表视图 canSend=false
    const convs = await request(app.getHttpServer()).get('/api/v1/conversations').set(auth(a.token)).expect(200);
    expect(convs.body.items[0].canSend).toBe(false);

    await unlock(a, bp.id, `IK_exp2_${suffix}`); // 重新解锁
    const ok = await send(a.id, b.id, '还在吗').expect(200);
    expect(ok.body.ActionStatus).toBe('OK');
  });

  // ==================== 接触升级三动作（§5.6 D7 留痕，I3 服务端下发） ====================
  it('三动作：call-phone 下发号码、exchange-wechat 卡片、send-photo 原图签名 URL；留痕可查；未解锁/过期 403/404', async () => {
    const { a, ap, b, bp } = await pair('act');

    // 未解锁：无会话 → 404
    await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/call-phone`).set(auth(a.token)).expect(404);

    const r = await unlock(a, bp.id, `IK_act_${suffix}`);
    await prisma.profile.update({ where: { id: ap.id }, data: { photos: [{ objectKey: 'photos/a0.jpg', sort: 0 }] } });

    const noPhoto = await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/send-photo`).set(auth(a.token)).send({ photoIndex: 9 }).expect(400);
    expect(noPhoto.body.message).toContain('照片');

    const call = await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/call-phone`).set(auth(a.token)).expect(200);
    expect(call.body).toMatchObject({ action: 'CALL_PHONE', cardSent: true });
    expect(call.body.phone).toMatch(/^139/);

    const wx = await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/exchange-wechat`).set(auth(a.token)).expect(200);
    expect(wx.body).toMatchObject({ action: 'EXCHANGE_WECHAT', phone: null });

    const photo = await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/send-photo`).set(auth(a.token)).send({ photoIndex: 0 }).expect(200);
    expect(photo.body.photoUrl).toContain('mock-cdn.local/photos/a0.jpg');

    const convId = (await prisma.conversation.findFirstOrThrow({ where: { unlockRecordId: BigInt(r.body.unlockId) } })).id;
    const logs = await request(app.getHttpServer()).get(`/api/v1/conversations/${convId}/contact-actions`).set(auth(a.token)).expect(200);
    expect(logs.body.items.map((i: { action: string }) => i.action).sort()).toEqual(['CALL_PHONE', 'EXCHANGE_WECHAT', 'SEND_PHOTO']);
    const cards = await prisma.message.count({ where: { convId, type: 'CONTACT_CARD' } });
    expect(cards).toBe(3);
    expect(await prisma.contactActionLog.count({ where: { convId } })).toBe(3);

    // 过期后三动作 403 UNLOCK_REQUIRED（已过期话术）
    await prisma.unlockRecord.update({ where: { id: BigInt(r.body.unlockId) }, data: { expireAt: new Date(Date.now() - 1000) } });
    const gone = await request(app.getHttpServer()).post(`/api/v1/contact/${bp.id}/call-phone`).set(auth(a.token)).expect(403);
    expect(gone.body.errorCode).toBe('UNLOCK_REQUIRED');
    expect(gone.body.message).toContain('过期');
  });

  // ==================== 离线送达：订阅消息（Exit：模板 ID 进 reward_config） ====================
  it('NotifyPref GRANTED 且开关 im 开 → 发消息触发订阅消息，模板 ID 读 im_config；DENIED/开关关不触发', async () => {
    const cfg = await app.get<ConfigCenter>(CONFIG_CENTER).get<{ sdkAppId: string; subscribeTemplates: { newMessage: string } }>(ConfigKeys.IM_CONFIG);
    expect(cfg.subscribeTemplates.newMessage).toBeTruthy(); // Exit 标准：模板 ID 在 reward_config

    const { a, b, bp } = await pair('sub');
    await unlock(a, bp.id, `IK_sub_${suffix}`);
    await prisma.notifyPref.create({ data: { userId: b.id, switches: { im: true }, subscribeAuthStatus: 'GRANTED' } });

    const spy = jest.spyOn(wechat, 'sendSubscribeMsg').mockResolvedValue(undefined);
    await send(a.id, b.id, '第一次消息').expect(200);
    await new Promise((res) => setTimeout(res, 100)); // notifyOffline fire-and-forget
    expect(spy).toHaveBeenCalledWith(expect.any(String), cfg.subscribeTemplates.newMessage, expect.objectContaining({ digest: '第一次消息' }), 'pages/message/index');
    spy.mockClear();

    await prisma.notifyPref.update({ where: { userId: b.id }, data: { subscribeAuthStatus: 'DENIED' } });
    await send(a.id, b.id, '第二次消息').expect(200);
    await new Promise((res) => setTimeout(res, 100));
    expect(spy).not.toHaveBeenCalled();

    await prisma.notifyPref.update({ where: { userId: b.id }, data: { subscribeAuthStatus: 'GRANTED', switches: { im: false } } });
    await send(a.id, b.id, '第三次消息').expect(200);
    await new Promise((res) => setTimeout(res, 100));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // ==================== 生命周期钩子：注册 → accountImport ====================
  it('新用户注册触发 IM accountImport（userId→IM id）', async () => {
    const spy = jest.spyOn(im, 'accountImport').mockResolvedValue(undefined);
    await newUser('imp');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/^\d+$/);
    spy.mockRestore();
  });
});
