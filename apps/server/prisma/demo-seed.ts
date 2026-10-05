/**
 * Demo 数据种子（仅本地联调，不进 CI/e2e）：
 * - DEMO_actor：已实名、10 次 PAID 额度、已过审生效档案（男，1995 年生）
 *   登录 code = `DEMO_actor`（mock openid = mock_openid_DEMO_actor）
 * - 20 个异性候选档案（APPROVED + published + ACTIVE），落入 age_window(±10) 年龄窗
 * 运行：pnpm --filter @qinjia/server db:demo
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CITIES = ['杭州', '杭州', '杭州', '宁波', '宁波', '上海', '上海', '北京', '深圳', '广州', '成都', '武汉', '南京', '苏州', '长沙', '西安', '重庆', '天津', '合肥', '青岛'];
const NAMES = ['王阿姨', '李妈妈', '张阿姨', '刘妈妈', '陈阿姨', '杨妈妈', '赵阿姨', '黄妈妈', '周阿姨', '吴妈妈', '徐阿姨', '孙妈妈', '马阿姨', '朱妈妈', '胡阿姨', '郭妈妈', '何阿姨', '高妈妈', '林阿姨', '罗妈妈'];
const EDUS = ['BACHELOR', 'BACHELOR', 'MASTER', 'BACHELOR', 'COLLEGE', 'MASTER', 'BACHELOR', 'DOCTOR', 'COLLEGE', 'BACHELOR'] as const;
const JOBS = ['教师', '医生', '公务员', '会计师', '设计师', '程序员', '护士', '银行职员', '律师', 'HR'];
const INTROS = ['孩子性格温和，工作稳定，希望找个踏实过日子的人', '女儿独立孝顺，圈子简单，盼有共同话题的另一半', '孩子孝顺顾家，无不良嗜好，诚意找结婚对象', '工作认真生活简单，希望遇到双向奔赴的人', '开朗爱笑，孝敬父母，期待稳定的小家庭'];

async function main() {
  // ===== DEMO 主角（家长视角登录入口）=====
  const actor = await prisma.user.upsert({
    where: { openid: 'mock_openid_DEMO_actor' },
    update: {},
    create: {
      openid: 'mock_openid_DEMO_actor',
      nickname: 'Demo 家长',
      phone: '13900000000',
      inviteCode: 'DEMOACTR',
      idCardNoHash: 'demo_hash_actor',
      memberLevel: 'PAID',
      memberExpireAt: new Date(Date.now() + 30 * 864e5),
    },
  });

  // PAID 额度 10 次（重跑重置：先清旧 demo 批次）
  await prisma.memberQuota.deleteMany({ where: { userId: actor.id, source: 'PAID', total: 10 } });
  await prisma.memberQuota.create({
    data: { userId: actor.id, source: 'PAID', total: 10, remaining: 10, status: 'ACTIVE', expireAt: new Date(Date.now() + 30 * 864e5) },
  });

  await prisma.profile.upsert({
    where: { matchNo: 'DEMOACTOR01' },
    update: {},
    create: {
      matchNo: 'DEMOACTOR01', ownerUserId: actor.id, isActive: true,
      relation: 'FATHER', gender: 'MALE', birthYear: 1995, heightCm: 178,
      education: 'BACHELOR', occupation: '软件工程师', incomeRange: 'R20K_50K',
      residenceCity: '杭州', residenceDistrict: '西湖区', intro: '孩子踏实上进，工作稳定，家长诚意代征婚',
      bodyType: '标准',
      expectHeightMin: 160, expectHeightMax: 172, expectBirthYearMin: 1992, expectBirthYearMax: 1999,
      expectEducation: 'COLLEGE', expectCity: '杭州',
      photos: [{ objectKey: 'demo/photos/actor_1.jpg', sort: 1 }],
      isMaritalVerified: true, maritalStatus: 'UNMARRIED',
      singleCommitmentSignedAt: new Date(), singleCommitmentVersion: 'v1',
      auditStatus: 'APPROVED', publishedAt: new Date(),
    },
  });

  // ===== 候选池：20 个女性档案（异性、年龄窗 1985–2005）=====
  let created = 0;
  for (let i = 0; i < 20; i += 1) {
    const openid = `mock_openid_DEMO_c${i}`;
    const owner = await prisma.user.upsert({
      where: { openid },
      update: {},
      create: {
        openid,
        nickname: NAMES[i],
        phone: `139${String(10000001 + i)}`, // 11 位
        inviteCode: `DEMO${String(i + 1).padStart(4, '0')}`,
        idCardNoHash: `demo_hash_c${i}`,
        memberLevel: i % 3 === 0 ? 'PAID' : 'NONE',
      },
    });
    const matchNo = `DEMOF${String(i + 1).padStart(2, '0')}`;
    const res = await prisma.profile.upsert({
      where: { matchNo },
      update: {},
      create: {
        matchNo, ownerUserId: owner.id, isActive: true,
        relation: i % 2 === 0 ? 'MOTHER' : 'FATHER', gender: 'FEMALE',
        birthYear: 1988 + (i % 12), heightCm: 158 + (i % 12),
        education: EDUS[i % EDUS.length], occupation: JOBS[i % JOBS.length],
        incomeRange: ['R10K_20K', 'R20K_50K', 'UNDISCLOSED'][i % 3],
        residenceCity: CITIES[i], residenceDistrict: i < 3 ? '西湖区' : null,
        intro: INTROS[i % INTROS.length],
        bodyType: '标准',
        // 择偶标准示例（详情页展示）
        expectHeightMin: 165, expectHeightMax: 180,
        expectBirthYearMin: 1988 + (i % 12) - 5, expectBirthYearMax: 1988 + (i % 12) + 3,
        expectEducation: 'BACHELOR', expectCity: CITIES[i],
        photos: [
          { objectKey: `demo/photos/c${i}_1.jpg`, sort: 1 },
          { objectKey: `demo/photos/c${i}_2.jpg`, sort: 2 },
        ],
        isMaritalVerified: i % 4 !== 0, // 部分未核验 → 演示警示/二次确认链路
        maritalStatus: 'UNMARRIED',
        singleCommitmentSignedAt: new Date(), singleCommitmentVersion: 'v1',
        auditStatus: 'APPROVED', publishedAt: new Date(),
      },
    });
    if (res.createdAt.getTime() > Date.now() - 5000) created += 1;
  }

  console.log(`demo-seed done: actor=${actor.id}(openid mock_openid_DEMO_actor, login code=DEMO_actor), candidates=20, newly created=${created}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
