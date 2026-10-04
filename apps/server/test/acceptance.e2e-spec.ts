import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Gender } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { KV_CACHE, KvCache } from '../src/providers/interfaces';

/**
 * Step 14 · PRD §10 验收用例专测（真实 MySQL/Redis，禁 mock 库）。
 * 其余用例已由前序 Step 套件带「用例 N」标签覆盖（见 docs/TEST-REPORT-P0.md 映射表）；
 * 本文件补齐唯一未做全链路验证的 用例 4：
 *   双档案切换 → 推荐流随生效档案变化；对外身份（他人 feed）随生效档案变化；旧解锁/会话不受影响。
 */
describe('§10 验收用例 4：双档案切换全链路 (e2e, 真实 MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let pSeq = 0;
  let phoneSeq = 0;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const todayKey = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10); };
  const feedCacheKey = (profileId: bigint) => `feed:${profileId}:${todayKey()}`;
  // 全池聚合分页：库内有历史套件遗留候选，需「包含/不包含」断言（单页上限 50）
  async function getAllFeed(token: string): Promise<{ gender: string; profileId: string }[]> {
    const first = await request(server()).get('/api/v1/feed?size=50&page=1').set(auth(token)).expect(200);
    const items = [...first.body.items] as { gender: string; profileId: string }[];
    const pages = Math.ceil(first.body.total / 50);
    for (let p = 2; p <= pages; p += 1) {
      const next = await request(server()).get(`/api/v1/feed?size=50&page=${p}`).set(auth(token)).expect(200);
      items.push(...next.body.items);
    }
    return items;
  }

  async function mkUser(tag: string): Promise<{ id: bigint; token: string }> {
    const login = await request(server()).post('/api/v1/auth/login').send({ code: `AC_${tag}_${suffix}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { openid: `mock_openid_AC_${tag}_${suffix}` } });
    phoneSeq += 1;
    await prisma.user.update({ where: { id: user.id }, data: { idCardNoHash: `achash_${tag}_${suffix}_${phoneSeq}`, phone: `136${suffix}${phoneSeq}` } });
    await prisma.memberQuota.deleteMany({ where: { userId: user.id } }); // 隔离注册赠礼，按需发放
    return { id: user.id, token: login.body.token };
  }

  async function mkProfile(ownerUserId: bigint, gender: Gender, birthYear: number, isActive: boolean) {
    pSeq += 1;
    return prisma.profile.create({
      data: {
        matchNo: `AC${suffix}_${pSeq}`, ownerUserId, isActive,
        relation: 'MOTHER', gender, birthYear, heightCm: 170,
        education: 'BACHELOR', occupation: '工程师', residenceCity: '杭州',
        photos: [], isMaritalVerified: true, auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
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
    // 共享库隔离：停用全部 AC 档案（含历史运行遗留），避免污染 feed 套件的全池 total 精确断言
    await prisma.profile.updateMany({ where: { matchNo: { startsWith: 'AC' } }, data: { isActive: false } });
    await app.close();
  });

  it('用例 4：切换生效档案 → feed 性别窗翻转；他人 feed 仅见生效档案；旧解锁与会话不受影响', async () => {
    // A：两份已审档案——P1 儿子(男 1990, 生效) / P2 女儿(女 1995, 未生效)
    const a = await mkUser('a4');
    const p1 = await mkProfile(a.id, Gender.MALE, 1990, true);
    const p2 = await mkProfile(a.id, Gender.FEMALE, 1995, false);

    // 旁观者：VF 女 1990（只见男候选）/ VM 男 1995（只见女候选）
    const vf = await mkUser('vf4');
    const vfProf = await mkProfile(vf.id, Gender.FEMALE, 1990, true);
    const vm = await mkUser('vm4');
    const vmProf = await mkProfile(vm.id, Gender.MALE, 1995, true);

    // 解锁目标 B：女 1995（已核验）
    const b = await mkUser('b4');
    const bProf = await mkProfile(b.id, Gender.FEMALE, 1995, true);
    await prisma.memberQuota.create({
      data: { userId: a.id, source: 'PAID', total: 2, remaining: 2, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
    });

    // ① 生效=P1(男娃) → A 的 feed 只出现女候选（硬过滤性别随生效档案）
    const feedA1 = await getAllFeed(a.token);
    expect(feedA1.length).toBeGreaterThan(0);
    for (const it of feedA1) expect(it.gender).toBe('FEMALE');

    // ② 对外身份：VF 的 feed 出现 P1，不出现未生效的 P2
    const vfIds = (await getAllFeed(vf.token)).map((i) => i.profileId);
    expect(vfIds).toContain(p1.id.toString());
    expect(vfIds).not.toContain(p2.id.toString());

    // ③ 切换生效档案前，A 用额度解锁 B（会话建立）
    const un = await request(server()).post('/api/v1/unlock').set(auth(a.token)).set('Idempotency-Key', `IK_ac4_${suffix}`).send({ profileId: bProf.id.toString() }).expect(200);
    expect(un.body.payType).toBe('QUOTA');
    expect(un.body.conversation.canSend).toBe(true);
    const rec = await prisma.unlockRecord.findFirstOrThrow({ where: { initiatorUserId: a.id, targetProfileId: bProf.id, status: 'ACTIVE' } });

    // ④ 切换到 P2(女娃)
    const sw = await request(server()).put('/api/v1/profiles/active').set(auth(a.token)).send({ profileId: p2.id.toString() }).expect(200);
    expect(sw.body.id).toBe(p2.id.toString());

    // ⑤ 推荐流随生效档案变化：A 的 feed 全部变为男候选
    await app.get<KvCache>(KV_CACHE).del(feedCacheKey(p1.id)); // 双保险：新 key 本不同，防御跨日
    const feedA2 = await getAllFeed(a.token);
    expect(feedA2.length).toBeGreaterThan(0);
    for (const it of feedA2) expect(it.gender).toBe('MALE');

    // ⑥ 对外身份切换：VF 不再见 P1（已失效），VM 见到 P2（需清 VF/VM 当日缓存）
    await app.get<KvCache>(KV_CACHE).del(feedCacheKey(vfProf.id));
    await app.get<KvCache>(KV_CACHE).del(feedCacheKey(vmProf.id));
    const vfIds2 = (await getAllFeed(vf.token)).map((i) => i.profileId);
    expect(vfIds2).not.toContain(p1.id.toString());
    const vmIds = (await getAllFeed(vm.token)).map((i) => i.profileId);
    expect(vmIds).toContain(p2.id.toString());

    // ⑦ 旧解锁/会话不受影响：记录仍 ACTIVE；双方 IM 回调照常放行（红线 I3 用户级权限）
    const after = await prisma.unlockRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after.status).toBe('ACTIVE');
    const ab = await request(server()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: a.id.toString(), To_Account: b.id.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: '你好，孩子的事聊聊' } }],
    }).expect(200);
    expect(ab.body.ActionStatus).toBe('OK');
    const ba = await request(server()).post('/api/v1/im/callback').send({
      CallbackCommand: 'BeforeSendMsg', From_Account: b.id.toString(), To_Account: a.id.toString(),
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: '好的' } }],
    }).expect(200);
    expect(ba.body.ActionStatus).toBe('OK');
    // 额度只扣 1 次（切换档案不重扣）
    const quota = await prisma.memberQuota.findFirstOrThrow({ where: { userId: a.id, status: 'ACTIVE' } });
    expect(quota.remaining).toBe(1);
  });
});
