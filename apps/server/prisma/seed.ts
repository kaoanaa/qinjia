/**
 * Seed：reward_config 灌入 PRD §11 全部默认值（唯一真源，禁止业务代码硬编码）
 * + 初始管理员 + 示例运营位。
 * 运行：pnpm --filter @qinjia/server db:seed
 */
import { AdminRole, OpsSlotType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 金额一律分；时长一律天 */
const CONFIG_DEFAULTS: Record<string, unknown> = {
  // §11-1 单次解锁价 ¥19.9
  unlock_once_price: { amountCent: 1990 },
  // §11-2 付费套餐与额度（会员期内 30 额度，D2）
  paid_member_plan: {
    options: [
      { planId: 'month', name: '月度会员', days: 30, quota: 30, amountCent: 9900 },
      { planId: 'quarter', name: '季度会员', days: 90, quota: 30, amountCent: 23900 },
      { planId: 'year', name: '年度会员', days: 365, quota: 30, amountCent: 79900 },
    ],
    intentionUpgradeCouponTemplateId: null, // 诚意会员立减券（upsell，P1 配置）
  },
  // §11-3 新用户注册礼（D9）
  newbie_reward: { days: 7, quota: 10 },
  // §11-4 邀请奖励（D10）
  invite_reward: { days: 7, quota: 10 },
  // §11-5 年龄窗（§6.2）
  age_window: { minAge: 18, maxAge: 60, diffYears: 10 },
  // §11-6 随机坑位比（D4）
  random_ratio: { percent: 50 },
  // §11-7 每日轮换比（D4）
  rotation_ratio: { percent: 30 },
  // §11-8 feed 各项权重分（§6.2）
  feed_weights: {
    sameCity: 30,
    sameDistrict: 10,
    educationMatch: 10,
    incomeOverlap: 10,
    active7d: 15,
    freshProfile48h: 20,
    maritalVerified: 30,
    maritalUnverified: -20,
  },
  // §11-9 话术开关与文案（§5.3/§6.3）
  copywriting: {
    rotationCardTipEnabled: true,
    rotationCardTip: '明天起将无法查看对方资料',
    unverifiedWarnTop: '该用户未提供婚姻证明，请注意甄别',
    unverifiedUnlockConfirm: '对方未提供婚姻证明，存在一定风险，是否确认解锁？',
    unlockBtnRealnameGuide: '完成实名激活 10 次免费解锁',
    privileges: [
      { key: 'unlock', label: '解锁联系方式' },
      { key: 'im', label: '双向畅聊' },
      { key: 'records', label: '解锁记录' },
    ],
  },
  // §11-10 提醒节点（§3.2/§5.11）
  remind_nodes: { trialBeforeDays: 2, paidBeforeDays: 7 },
  // §11-11 大额支付阈值（§5.10，¥500）
  big_pay_threshold: { amountCent: 50000 },
  // §11-12 券模板（示例：体验到期续费券）
  coupon_templates: {
    renew_push_trial: { name: '体验到期续费券', scope: 'MEMBER', amountCent: 2000, validDays: 7, minAmountCent: 0 },
  },
  // §11-13 运营位内容（默认空，后台配置）
  ops_slots: {},
  // §11-14 解锁有效期与额度语义（D3/D12）
  unlock_validity: { days: 30 },
};

async function main() {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await prisma.rewardConfig.upsert({
      where: { configKey: key },
      update: { value: value as object, updatedBy: 'seed' },
      create: { configKey: key, value: value as object, updatedBy: 'seed' },
    });
  }

  const adminPasswordPlaceholder = 'CHANGE_ME_bcrypt_on_step13';
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPasswordPlaceholder, // Step 13 接入真实 hash 后强制改密
      role: AdminRole.SUPER,
    },
  });

  await prisma.opsSlot.upsert({
    where: { id: 1 },
    update: {},
    create: {
      type: OpsSlotType.TAB_CENTER,
      content: { title: '精彩活动', enabled: false, placeholder: true },
      startAt: new Date(),
      endAt: new Date(Date.now() + 365 * 864e5),
    },
  });

  const count = await prisma.rewardConfig.count();
  console.log(`seed done: reward_config=${count} keys (expect ${Object.keys(CONFIG_DEFAULTS).length}), admin=1, ops_slot=1`);
  if (count !== Object.keys(CONFIG_DEFAULTS).length) {
    throw new Error('reward_config 数量与 §11 清单不一致');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
