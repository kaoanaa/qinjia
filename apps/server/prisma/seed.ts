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
    // §5.6 IM 回调拒绝话术（ErrorInfo 展示给发送者）
    chatNotUnlockedTip: '对方尚未解锁你，解锁后才能发消息',
    chatExpiredSendTip: '解锁已过期，重新解锁后才能发送消息',
    chatBlockedContactTip: '为防止诈骗，解锁前禁止发送微信号/手机号等联系方式',
    chatSensitiveTip: '内容涉及敏感词，请文明交流',
    // §5.4 Step 11 转发微信卡片+海报话术（红线 I1）
    shareCardTitle: '这里有个合适的亲家，介绍给你看看',
    posterTip: '长按识别，查看孩子完整资料',
    // Step 12 系统消息模板（§5.12 审核/到期/奖励到账；话术读配置，红线 I1）
    notifyTemplates: {
      realnameUnfreeze: { title: '实名审核通过', body: '恭喜！实名认证已通过，冻结的解锁次数已恢复，可以去解锁联系方式啦' },
      unlockExpire: { title: '解锁已到期', body: '您解锁的联系方式已到期，聊天功能已暂停；如仍有意向可重新解锁继续联系' },
      ticketReceived: { title: '工单已受理', body: '我们已收到您的反馈，客服将在承诺时限内与您联系' },
    },
  },
  // §6.5/§5.13 Step 12：工单首响 SLA（小时，禁止代码硬编码 48）
  ticket_sla: { firstResponseHours: 48 },
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
  // Step 10 Exit：IM 通道配置（订阅消息模板 ID 进 reward_config，禁止代码硬编码）
  im_config: {
    sdkAppId: 'MOCK_IM_SDK_1400000000',
    subscribeTemplates: {
      newMessage: 'MOCK_TPL_NEW_MESSAGE', // 离线新消息补达模板
    },
    sensitiveWords: ['转账', '汇款', '刷单', '杀猪盘'],
    // 联系方式防爬策略（§5.6）：文本走服务端正则拦截；图片走 msgAudit 鉴黄 + OCR 兜底（真实实现接入天御）
    imageGuardStrategy: 'msg_audit_with_ocr_fallback',
  },
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

  // Step 12：消息中心顶部「防诈指南」Banner（运营位内容本身即配置，红线 I1 合规）
  await prisma.opsSlot.upsert({
    where: { id: 2 },
    update: {},
    create: {
      type: OpsSlotType.BANNER,
      content: {
        title: '防诈提醒',
        text: '凡是要求转账、汇款、刷单、投资的都是诈骗！解锁前请勿透露手机号/微信号',
        linkPage: 'pages/safety/guide/index',
      },
      startAt: new Date('2026-01-01T00:00:00Z'),
      endAt: new Date('2099-12-31T23:59:59Z'),
      sort: 1,
      enabled: true,
    },
  });

  const count = await prisma.rewardConfig.count();
  const slots = await prisma.opsSlot.count();
  console.log(`seed done: reward_config=${count} keys (expect ${Object.keys(CONFIG_DEFAULTS).length}), admin=1, ops_slot=${slots}`);
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
