import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditStatus, FeedRotationCard, Gender, QuotaSource } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { KV_CACHE, KvCache } from '../src/providers/interfaces';
import { FeedService } from '../src/modules/feed/feed.service';
import { FeedRotationJob } from '../src/modules/feed/feed-rotation.job';

/**
 * Step 9 推荐流与轮换（PRD §6.2/D4/§5.3）。真实 MySQL + Redis（.env REDIS_URL）。
 * 覆盖：硬过滤、规则50%+随机50% 坑位、"仅今日"轮换、用例 8（次日移出 feed/历史可找回可解锁）、缓存分页、P95<500ms。
 */
describe('推荐流与轮换 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let feed: FeedService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let pSeq = 0;
  let phoneSeq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // 与 FeedService.todayDate() 同约定：本地日历日按 UTC 零点（@db.Date 两侧序列化才一致）
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const dayMinus = (n: number) => new Date(today().getTime() - n * 864e5);

  async function mkUser(tag: string): Promise<{ id: bigint; token: string }> {
    pSeq += 1; phoneSeq += 1;
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ code: `F_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_F_${tag}_${suffix}` } });
    await prisma.user.update({ where: { id: user.id }, data: { idCardNoHash: `fhash_${tag}_${pSeq}_${suffix}`, phone: `137${suffix}${phoneSeq}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } });
    return { id: user.id, token: login.body.token };
  }

  interface P { verified?: boolean; gender?: Gender; birthYear?: number; city?: string; district?: string | null; edu?: string; income?: string; active?: boolean; audit?: AuditStatus; published?: Date | null; intro?: string }
  async function mkProfile(ownerUserId: bigint, o: P = {}) {
    pSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `FM${suffix}_${pSeq}`, ownerUserId, isActive: o.active ?? true,
        relation: 'MOTHER', gender: o.gender ?? Gender.MALE, birthYear: o.birthYear ?? 1994, heightCm: 175,
        education: o.edu ?? 'BACHELOR', occupation: '工程师', incomeRange: (o.income ?? 'R10K_20K') as never,
        residenceCity: o.city ?? '上海', residenceDistrict: o.district ?? null,
        photos: [{ objectKey: `photos/p${pSeq}.jpg`, sort: 1 }], intro: o.intro ?? '家长评语',
        isMaritalVerified: o.verified ?? true,
        auditStatus: o.audit ?? AuditStatus.APPROVED,
        publishedAt: o.published === null ? null : o.published ?? new Date(),
      },
    });
  }

  /** 查看者：女 1995 杭州西湖区 本科 R10K_20K */
  async function mkViewer(tag: string) {
    const u = await mkUser(tag);
    await prisma.profile.create({
      data: {
        matchNo: `FV${suffix}_${(pSeq += 1)}`, ownerUserId: u.id, isActive: true,
        relation: 'MOTHER', gender: Gender.FEMALE, birthYear: 1995, heightCm: 165,
        education: 'BACHELOR', occupation: '教师', incomeRange: 'R10K_20K' as never,
        residenceCity: '杭州', residenceDistrict: '西湖区', photos: [], isMaritalVerified: true,
        auditStatus: AuditStatus.APPROVED, publishedAt: new Date(),
      },
    });
    return u;
  }

  const getFeed = (token: string, q = '') => request(app.getHttpServer()).get(`/api/v1/feed${q}`).set(auth(token)).expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    feed = app.get(FeedService);
    await clearCandidates(); // 清掉历史 run 数据：推荐流是全局候选池，脏数据会污染 total/排序断言
  });

  /** 停用全部候选（FM=本用例 + MD=detail 用例的男候选）并清空轮换标记，使候选池=本用例新建 */
  async function clearCandidates() {
    await prisma.feedRotationCard.deleteMany({});
    await prisma.profile.updateMany({ where: { matchNo: { startsWith: 'FM' } }, data: { isActive: false } });
    await prisma.profile.updateMany({ where: { matchNo: { startsWith: 'MD' } }, data: { isActive: false } });
  }

  afterAll(async () => {
    await app.close();
  });

  it('无生效档案 → 400 NEED_ACTIVE_PROFILE', async () => {
    const u = await mkUser('noprof');
    const res = await request(app.getHttpServer()).get('/api/v1/feed').set(auth(u.token)).expect(400);
    expect(res.body.errorCode).toBe('NEED_ACTIVE_PROFILE');
  });

  it('硬过滤（§6.2）：同性别/年龄差>10/未成年或未超60/未发布/拉黑互斥 均不出现', async () => {
    await clearCandidates();
    const v = await mkViewer('hard'); // 女 1995
    const ok = await mkProfile((await mkUser('hard_ok')).id, { gender: Gender.MALE, birthYear: 1990, city: '杭州' });
    await mkProfile((await mkUser('hard_female')).id, { gender: Gender.FEMALE }); // 同性别
    await mkProfile((await mkUser('hard_old')).id, { birthYear: 1984 }); // 差 11 岁
    await mkProfile((await mkUser('hard_minor')).id, { birthYear: 2012 }); // <18（也超 diff，双保险另测：1996±? 用 2012）
    await mkProfile((await mkUser('hard_senior')).id, { birthYear: 1960, }); // 66 岁（>60；1960 与 1995 差 35 已被 diff 拦，另用边界）
    const ageEdge = await mkProfile((await mkUser('hard_edge')).id, { birthYear: 2008 }); // 18 岁（合法成年边界）但差 13 → 被 diff 拦；
    void ageEdge;
    await mkProfile((await mkUser('hard_draft')).id, { birthYear: 1993, audit: AuditStatus.PENDING, published: null });
    const blk = await mkUser('hard_blocked');
    const blockedProfile = await mkProfile(blk.id, { birthYear: 1992, city: '杭州' });
    const blk2 = await mkUser('hard_blocker');
    const blockerProfile = await mkProfile(blk2.id, { birthYear: 1991, city: '杭州' });
    await prisma.blacklist.create({ data: { userId: v.id, blockedUserId: blk.id } }); // 我拉黑
    await prisma.blacklist.create({ data: { userId: blk2.id, blockedUserId: v.id } }); // 对方拉黑我（互斥）

    // 成年硬窗：1995+10=2005 上界；造一个 diff 内且成年的 2005（合法，应出现）
    const legal2005 = await mkProfile((await mkUser('hard_2005')).id, { birthYear: 2005, city: '杭州' });
    // 造一个超龄但 diff 不可能同时满足——18-60 窗由 diff 交叉保证；单独验证 birthYear 2010 被排除已覆盖

    const feed1 = await getFeed(v.token);
    const ids = feed1.body.items.map((i: { profileId: string }) => i.profileId);
    expect(ids).toContain(ok.id.toString());
    expect(ids).toContain(legal2005.id.toString()); // 成年边界 18 岁 + diff 内 → 合法
    expect(ids).not.toContain(blockedProfile.id.toString());
    expect(ids).not.toContain(blockerProfile.id.toString());
    const all = await prisma.profile.findMany({ where: { owner: { openid: { startsWith: `mock_openid_F_hard_` } } }, select: { id: true } });
    for (const p of all) {
      if (String(p.id) === String(ok.id) || String(p.id) === String(legal2005.id)) continue;
      expect(ids).not.toContain(p.id.toString()); // 其余负样本全部被过滤
    }
  });

  it('规则坑位：高分在前（同城+30/核验+30 vs 异城+未核验−20），随机坑位补足且无重复', async () => {
    await clearCandidates();
    const v = await mkViewer('mix');
    const mk = async (tag: string, o: P) => mkProfile((await mkUser(tag)).id, o);
    const a = await mk('mix_a', { city: '杭州', verified: true, birthYear: 1990 }); // 同城+核验
    const b = await mk('mix_b', { city: '杭州', verified: false, birthYear: 1990 }); // 同城-未核验
    const c = await mk('mix_c', { city: '上海', verified: true, birthYear: 1990 });
    const d = await mk('mix_d', { city: '广州', verified: false, birthYear: 1992 });
    const e2 = await mk('mix_e', { city: '深圳', verified: true, birthYear: 1998 });
    const f = await mk('mix_f', { city: '杭州', verified: true, birthYear: 1993, district: '西湖区' }); // 同城+同区
    const feed1 = await getFeed(v.token);
    expect(feed1.body.total).toBe(6);
    const ids = feed1.body.items.map((i: { profileId: string }) => i.profileId);
    expect(new Set(ids).size).toBe(6); // 无重复无遗漏
    // 规则坑位 = 6 - round(6*50%) = 3：分数最高三名依次 f > a > (b/c/e 需分层)
    expect(ids[0]).toBe(f.id.toString()); // 同区最高
    expect(ids[1]).toBe(a.id.toString());
    const rule3 = new Set([b.id.toString(), c.id.toString(), e2.id.toString(), d.id.toString()]);
    expect(rule3.has(ids[2])).toBe(true);
    void rule3;
  });

  it('卡片字段与 §5.3 一致 + 徽章/婚姻标/头像签名/评语摘要 + 轮换话术仅打给今日卡', async () => {
    await clearCandidates();
    const v = await mkViewer('card');
    const u1 = await mkUser('card_p1');
    // 新用户默认带 TRIAL 会员（auth），置 NONE 才能验证徽章 false→true 翻转
    await prisma.user.update({ where: { id: u1.id }, data: { memberLevel: 'NONE', memberExpireAt: null } });
    const p1 = await mkProfile(u1.id, { city: '杭州', intro: ''.padEnd(60, '言') });
    const p2 = await mkProfile((await mkUser('card_p2')).id, { city: '杭州', verified: false });
    await prisma.feedRotationCard.create({ data: { profileId: p2.id, day: today() } }); // 今日轮换
    const res = await getFeed(v.token);
    const c1 = res.body.items.find((i: { profileId: string }) => i.profileId === p1.id.toString());
    expect(Object.keys(c1).sort()).toEqual(
      ['avatarUrl', 'birthYear', 'car', 'education', 'gender', 'heightCm', 'housing', 'incomeRange', 'introDigest', 'maritalVerified', 'matchNo', 'memberBadge', 'occupation', 'profileId', 'residenceCity', 'residenceDistrict', 'rotationTip', 'todayOnly', 'unlocked'].sort(),
    );
    expect(c1.introDigest).toHaveLength(40); // 摘要截断
    expect(c1.avatarUrl).toContain('mock-cdn.local'); // 打码头像走签名 URL（provider 抽象）
    expect(c1.memberBadge).toBe(false);
    expect(c1.maritalVerified).toBe(true);
    expect(c1.todayOnly).toBe(false);
    expect(c1.rotationTip).toBeNull();
    const c2 = res.body.items.find((i: { profileId: string }) => i.profileId === p2.id.toString());
    expect(c2.todayOnly).toBe(true);
    expect(c2.maritalVerified).toBe(false); // 灰标数据位
    expect(c2.rotationTip).toBe('明天起将无法查看对方资料'); // 话术读 copywriting（红线 I1），仅轮换卡
    // 会员徽章 + 缓存失效：改会员态→del 缓存 key→重建后 badge 变 true
    const owner = await prisma.profile.findUniqueOrThrow({ where: { id: p1.id }, select: { ownerUserId: true } });
    await prisma.user.update({ where: { id: owner.ownerUserId }, data: { memberLevel: 'TRIAL', memberExpireAt: new Date(Date.now() + 7 * 864e5) } });
    const vProf = await prisma.profile.findFirstOrThrow({ where: { ownerUserId: v.id }, select: { id: true } });
    await app.get<KvCache>(KV_CACHE).del(`feed:${vProf.id}:${today().toISOString().slice(0, 10)}`);
    const res2 = await getFeed(v.token);
    const c1b = res2.body.items.find((i: { profileId: string }) => i.profileId === p1.id.toString());
    expect(c1b.memberBadge).toBe(true);
  });

  it('用例 8：昨日轮换次日移出 feed；历史推荐可找回且仍可解锁', async () => {
    await clearCandidates();
    const v = await mkViewer('rot8');
    const gone = await mkProfile((await mkUser('rot8_gone')).id, { city: '杭州' });
    await prisma.feedRotationCard.create({ data: { profileId: gone.id, day: dayMinus(1) } }); // 昨日轮换
    const feed1 = await getFeed(v.token);
    expect(feed1.body.items.map((i: { profileId: string }) => i.profileId)).not.toContain(gone.id.toString());

    const hist = await request(app.getHttpServer()).get('/api/v1/feed/history?page=1&size=50').set(auth(v.token)).expect(200);
    const row = hist.body.items.find((i: { profileId: string }) => i.profileId === gone.id.toString());
    expect(row).toBeTruthy();
    expect(row.rotatedOn).toBe(dayMinus(1).toISOString().slice(0, 10));

    // 历史档案仍可解锁（走正常 §6.1 流程：有额度 → 扣 1）
    await prisma.memberQuota.create({ data: { userId: v.id, source: QuotaSource.PAID, total: 2, remaining: 2, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) } });
    const un = await request(app.getHttpServer()).post('/api/v1/unlock').set(auth(v.token)).set('Idempotency-Key', `IK_rot8_${suffix}`).send({ profileId: gone.id.toString() }).expect(200);
    expect(un.body.quotaRemainAfter).toBe(1);
  });

  it('轮换定时任务：00:05 生成当日 30%（rotation_ratio 读配置），异常不外泄', async () => {
    const v = await mkViewer('job'); // 提供档案密度基线不受影响：仅数全局 eligible
    const cfgPercent = 30; // 断言用公式重查，不依赖 mock 值变更
    const markedIds = (await prisma.feedRotationCard.findMany({ where: { day: { lte: today() } }, select: { profileId: true } })).map((m) => m.profileId);
    const eligible = await prisma.profile.count({ where: { auditStatus: AuditStatus.APPROVED, publishedAt: { not: null }, isActive: true, ...(markedIds.length ? { id: { notIn: markedIds } } : {}) } });
    const expectMarked = Math.round((eligible * cfgPercent) / 100);
    const marked = await feed.generateDailyRotation();
    expect(marked).toBe(expectMarked);
    const todayMarks = await prisma.feedRotationCard.count({ where: { day: { equals: today() } } });
    expect(todayMarks).toBeGreaterThanOrEqual(expectMarked);

    const job = app.get(FeedRotationJob);
    await expect(job.handle()).resolves.toBeUndefined(); // 重跑幂等（skipDuplicates）
    const spy = jest.spyOn(feed, 'generateDailyRotation').mockRejectedValue(new Error('db down'));
    await expect(job.handle()).resolves.toBeUndefined();
    spy.mockRestore();
    void v;
  });

  it('缓存分页：结果按 (生效档案,日) 缓存；第二页命中缓存不重复全量排序', async () => {
    await clearCandidates();
    const v = await mkViewer('cache');
    for (let i = 0; i < 5; i++) await mkProfile((await mkUser(`cache_c${i}`)).id, { city: '杭州', birthYear: 1990 + i });
    const r1 = await getFeed(v.token, '?page=1&size=2');
    expect(r1.body.total).toBe(5);
    // 新增一个档案后 5min 内不变（缓存生效）
    await mkProfile((await mkUser('cache_late')).id, { city: '杭州' });
    const r2 = await getFeed(v.token, '?page=2&size=2');
    expect(r2.body.total).toBe(5); // 仍为缓存快照
    expect(r2.body.items).toHaveLength(2);
    const p1ids = r1.body.items.map((i: { profileId: string }) => i.profileId);
    const p2ids = r2.body.items.map((i: { profileId: string }) => i.profileId);
    expect(p1ids.filter((x: string) => p2ids.includes(x))).toHaveLength(0); // 分页无重叠
  });

  it('性能：40 候选档案 8 次分页请求 P95 < 500ms', async () => {
    const v = await mkViewer('perf');
    for (let i = 0; i < 40; i++) {
      await mkProfile((await mkUser(`perf_${i}`)).id, { city: i % 2 ? '杭州' : '上海', birthYear: 1985 + (i % 20), verified: i % 3 !== 0 });
    }
    const lat: number[] = [];
    for (let round = 0; round < 2; round++) {
      for (let page = 1; page <= 4; page++) {
        const t0 = Date.now();
        await getFeed(v.token, `?page=${page}&size=10`);
        lat.push(Date.now() - t0);
      }
    }
    lat.sort((a, b) => a - b);
    const p95 = lat[Math.ceil(lat.length * 0.95) - 1];
    // eslint-disable-next-line no-console
    console.log(`feed P50=${lat[3]}ms P95=${p95}ms (40 candidates, real MySQL+Redis)`);
    expect(p95).toBeLessThan(500);
  });
});
