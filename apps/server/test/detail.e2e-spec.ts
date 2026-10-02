import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { IM, ImProvider, KV_CACHE, KvCache } from '../src/providers/interfaces';

/**
 * Step 11 档案详情页与信任分级（PRD §5.4/§6.3，红线 I1/I3）。真实 MySQL，禁 mock 库。
 * Verify：未解锁照片模糊且原图 URL 不外泄——响应中所有图片 URL 均带打码处理参数、
 * 解锁后才出现无参清晰签名 URL；联系方式字段绝不出现在详情响应。
 */
describe('档案详情页与信任分级 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let im: ImProvider;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let phoneSeq = 0;
  let profileSeq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function newUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `D_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_D_${tag}_${suffix}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } });
    return { id: user.id, token: login.body.token };
  }

  async function realname(userId: bigint, tag: string) {
    phoneSeq += 1;
    const phone = `139${suffix}${phoneSeq}`;
    await prisma.user.update({ where: { id: userId }, data: { idCardNoHash: `mock_hash_${tag}_${suffix}`, phone } });
    return phone;
  }

  interface MkOpts {
    verified?: boolean;
    photos?: unknown[];
    published?: boolean;
    gender?: 'MALE' | 'FEMALE';
    active?: boolean;
  }

  async function makeProfile(ownerUserId: bigint, opts: MkOpts = {}) {
    profileSeq += 1;
    const published = opts.published !== false;
    return prisma.profile.create({
      data: {
        matchNo: `MD${suffix}_${profileSeq}`, ownerUserId, isActive: opts.active ?? true,
        relation: 'MOTHER', gender: opts.gender ?? 'FEMALE', birthYear: 1995, heightCm: 165,
        education: 'BACHELOR', occupation: '设计师', residenceCity: '杭州',
        residenceDistrict: '西湖区', hometown: '绍兴', hukou: '杭州',
        intro: '希望找到一个踏实过日子的人', incomeRange: 'R10K_20K',
        photos: opts.photos ?? [],
        isMaritalVerified: opts.verified ?? true,
        auditStatus: 'APPROVED',
        publishedAt: published ? new Date() : null,
      },
    });
  }

  const PHOTO_KEYS = [{ objectKey: `photos/m1_${suffix}.jpg`, sort: 0 }, { objectKey: `photos/m2_${suffix}.jpg`, sort: 1 }];

  /** 浏览者（男·实名+建档+有额度）+ 目标（女·建档可控）——保证目标可进浏览者推荐流（§6.2 性别相反） */
  async function viewerTargetPair(tag: string, opts: MkOpts = {}) {
    const v = await newUser(`v_${tag}`);
    await realname(v.id, `v_${tag}`);
    await makeProfile(v.id, { photos: [{ objectKey: `photos/v_${tag}.jpg`, sort: 0 }], gender: 'MALE' });
    await prisma.memberQuota.create({
      data: { userId: v.id, source: 'PAID', total: 3, remaining: 3, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });
    const t = await newUser(`t_${tag}`);
    const tPhone = await realname(t.id, `t_${tag}`);
    const tp = await makeProfile(t.id, { photos: PHOTO_KEYS, ...opts });
    return { v, t, tp, tPhone };
  }

  const detail = (token: string, matchNo: string) =>
    request(app.getHttpServer()).get(`/api/v1/feed/public/${matchNo}`).set(auth(token));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    im = app.get(IM);
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 未解锁：照片全打码，原图 URL 不外泄（Step 11 Verify） ====================
  it('未解锁详情：照片 blurred=true 且 URL 带打码参数、响应无清晰原图 URL/无联系方式；警示/印章/网格字段齐全', async () => {
    const { v, t, tp, tPhone } = await viewerTargetPair('lock', { verified: false });
    const res = await detail(v.token, tp.matchNo).expect(200);

    expect(res.body.photos).toHaveLength(2);
    for (const p of res.body.photos) {
      expect(p.blurred).toBe(true);
      expect(p.url).toContain('blur'); // CDN 打码处理参数
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(tPhone); // 手机号绝不下发（红线 I3）
    expect(res.body.contactVisible).toBe(false);
    expect(res.body.phone).toBeUndefined();
    expect(res.body.avatarUrl).toContain('blur');

    // §6.3 未核验置顶警示（话术读 copywriting 配置）
    expect(res.body.unverifiedWarnTop).toBe('该用户未提供婚姻证明，请注意甄别');
    // §5.4 代理人卡 + 资料网格
    expect(res.body).toMatchObject({
      matchNo: tp.matchNo, relation: 'MOTHER', realnameSeal: true, favorited: false, unlocked: false,
      residenceCity: '杭州', residenceDistrict: '西湖区', hometown: '绍兴', hukou: '杭州',
      age: new Date().getFullYear() - 1995, heightCm: 165, education: 'BACHELOR', occupation: '设计师',
    });
    expect(res.body.agentNickname).toContain('亲家'); // 注册默认昵称 亲家xxxx
    expect(res.body.intro).toBe('希望找到一个踏实过日子的人');

    // 访问即记 view_record；重复浏览 upsert 不重复插行
    expect(await prisma.viewRecord.count({ where: { fromUserId: v.id, toProfileId: tp.id } })).toBe(1);
    await detail(v.token, tp.matchNo).expect(200);
    expect(await prisma.viewRecord.count({ where: { fromUserId: v.id, toProfileId: tp.id } })).toBe(1);

    // 已核验档案警示为 null
    const { v: v2, tp: tp2 } = await viewerTargetPair('vf');
    const ok = await detail(v2.token, tp2.matchNo).expect(200);
    expect(ok.body.unverifiedWarnTop).toBeNull();

    // 自己的档案 / 未发布档案：404（不泄露存在性）
    await detail(v.token, tp2.matchNo.replace('MD', 'NOPE')).expect(404);
    const draft = await makeProfile(t.id, { published: false, active: false }); // 非生效：不破坏 D1 单生效不变式
    await detail(v.token, draft.matchNo).expect(404);
    const mine = await prisma.profile.findFirstOrThrow({ where: { ownerUserId: v.id } });
    await detail(v.token, mine.matchNo).expect(404);
  });

  // ==================== 解锁后：清晰原图限时 URL（服务端裁决，I3） ====================
  it('解锁后详情照片 blurred=false 无打码参数；contactVisible=true；过期回落打码', async () => {
    const { v, tp } = await viewerTargetPair('ulock');
    await request(app.getHttpServer())
      .post('/api/v1/unlock').set(auth(v.token)).set('Idempotency-Key', `IK_ulock_${suffix}`)
      .send({ profileId: tp.id.toString() }).expect(200);

    const res = await detail(v.token, tp.matchNo).expect(200);
    expect(res.body.unlocked).toBe(true);
    expect(res.body.contactVisible).toBe(true);
    for (const p of res.body.photos) {
      expect(p.blurred).toBe(false);
      expect(p.url).not.toContain('blur');
      expect(p.url).toContain('photos/m'); // 原图走限时签名 URL（600s 过期）
    }

    // 过期 → 重新打码（读时裁决，不依赖清扫任务）
    const rec = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: v.id } });
    await prisma.unlockRecord.update({ where: { id: rec.id }, data: { expireAt: new Date(Date.now() - 1000) } });
    const after = await detail(v.token, tp.matchNo).expect(200);
    expect(after.body.unlocked).toBe(false);
    expect(after.body.photos[0].blurred).toBe(true);
  });

  // ==================== 打招呼（P0 系统卡片占位）+ 收藏切换 ====================
  it('打招呼：系统卡片占位 + 当日计数；收藏 toggle true/false；自己 400', async () => {
    const { v, t, tp } = await viewerTargetPair('greet');
    const spy = jest.spyOn(im, 'sendSystemMsg').mockResolvedValue(undefined);

    const g1 = await request(app.getHttpServer()).post('/api/v1/greet').set(auth(v.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(g1.body.sent).toBe(true);
    expect(g1.body.greetCountToday).toBe(1);
    const g2 = await request(app.getHttpServer()).post('/api/v1/greet').set(auth(v.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(g2.body.greetCountToday).toBe(2);
    await new Promise((res) => setTimeout(res, 50)); // fire-and-forget
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[0][1])).toMatchObject({ kind: 'greet_card' });
    // 打招呼不建立聊天权限（P1 收件箱；未解锁仍禁发）
    const blocked = await request(app.getHttpServer()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: v.id.toString(), To_Account: t.id.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: '可以聊聊吗' } }],
    }).expect(200);
    expect(blocked.body.ActionStatus).toBe('FAIL');
    spy.mockRestore();

    const fav = await request(app.getHttpServer()).post('/api/v1/favorites').set(auth(v.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(fav.body.favorited).toBe(true);
    const d = await detail(v.token, tp.matchNo).expect(200);
    expect(d.body.favorited).toBe(true);
    const unfav = await request(app.getHttpServer()).post('/api/v1/favorites').set(auth(v.token)).send({ profileId: tp.id.toString() }).expect(200);
    expect(unfav.body.favorited).toBe(false);

    const mine = await prisma.profile.findFirstOrThrow({ where: { ownerUserId: v.id } });
    await request(app.getHttpServer()).post('/api/v1/favorites').set(auth(v.token)).send({ profileId: mine.id.toString() }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/greet').set(auth(v.token)).send({ profileId: mine.id.toString() }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/favorites').set(auth(v.token)).send({ profileId: 'abc' }).expect(400); // DTO 校验
  });

  // ==================== 上下滑切换（当日推荐序相邻项） ====================
  it('prev/next：与缓存的当日推荐序完全一致；无生效档案用户 → null', async () => {
    const { v, tp } = await viewerTargetPair('nb');
    const res = await detail(v.token, tp.matchNo).expect(200); // 内部 buildOrder 并写缓存

    // 直接以缓存序（feed 与详情共用同一份）为基准校验邻居，避免全局池规模干扰
    const myProf = await prisma.profile.findFirstOrThrow({ where: { ownerUserId: v.id }, select: { id: true } });
    const n = new Date();
    const day = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10);
    const cached = await app.get<KvCache>(KV_CACHE).get(`feed:${myProf.id}:${day}`);
    expect(cached).toBeTruthy();
    const order = JSON.parse(cached!) as Array<{ profileId: string }>;
    const idx = order.findIndex((o) => o.profileId === tp.id.toString());
    expect(idx).toBeGreaterThanOrEqual(0); // 女·同龄窗·同城目标必进男浏览者推荐池

    const neighbors = [order[idx - 1]?.profileId, order[idx + 1]?.profileId].filter(Boolean) as string[];
    const rows = await prisma.profile.findMany({ where: { id: { in: neighbors.map(BigInt) } }, select: { id: true, matchNo: true } });
    const byId = new Map(rows.map((r) => [String(r.id), r.matchNo]));
    expect(res.body.prevMatchNo).toBe(idx > 0 ? byId.get(order[idx - 1].profileId) : null);
    expect(res.body.nextMatchNo).toBe(idx < order.length - 1 ? byId.get(order[idx + 1].profileId) : null);

    // 无生效档案用户：详情可见，但没有切换序
    const { tp: tp2 } = await viewerTargetPair('nb_out');
    const noProf = await newUser('nb_none');
    await realname(noProf.id, 'nb_none');
    const noCtx = await detail(noProf.token, tp2.matchNo).expect(200);
    expect(noCtx.body.prevMatchNo).toBeNull();
    expect(noCtx.body.nextMatchNo).toBeNull();
  });

  // ==================== 转发微信卡片 + 海报（话术读配置，I1；编号防枚举） ====================
  it('share：title/poster.tip 来自 copywriting；封面打码；仅含 matchNo 不含 userId', async () => {
    const { v, t, tp } = await viewerTargetPair('share');
    const res = await request(app.getHttpServer()).get(`/api/v1/feed/public/${tp.matchNo}/share`).set(auth(v.token)).expect(200);
    expect(res.body.title).toBe('这里有个合适的亲家，介绍给你看看');
    expect(res.body.pagePath).toBe(`pages/feed/detail/index?matchNo=${tp.matchNo}&inviter=${v.id}`);
    expect(res.body.imageUrl).toContain('blur');
    expect(res.body.poster).toMatchObject({
      matchNo: tp.matchNo, gender: 'FEMALE', birthYear: 1995, heightCm: 165,
      education: 'BACHELOR', occupation: '设计师', residenceCity: '杭州',
      introDigest: '希望找到一个踏实过日子的人', tip: '长按识别，查看孩子完整资料',
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(t.id.toString()); // 海报数据不暴露对方 userId（防枚举）

    await request(app.getHttpServer()).get('/api/v1/feed/public/MDnotexist/share').set(auth(v.token)).expect(404);
  });
});
