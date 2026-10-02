/**
 * 完美亲家 · 全局枚举与常量（与 PRD §7 数据模型对齐）
 * 三端共用：miniapp / server / admin
 */

/** 代理人与主体的关系（D1） */
export enum Relation {
  FATHER = 'father',
  MOTHER = 'mother',
  SELF = 'self',
}

/** 用户会员等级 */
export enum MemberLevel {
  NONE = 'none',
  TRIAL = 'trial', // 7 天体验会员
  PAID = 'paid', // 付费会员
  INTENTION = 'intention', // 诚意会员（upsell，P1）
}

/** 额度来源（§7 member_quota.source） */
export enum QuotaSource {
  NEWBIE = 'newbie',
  INVITE = 'invite',
  PAID = 'paid',
}

/** 额度状态（D9：实名前 frozen） */
export enum QuotaStatus {
  FROZEN = 'frozen',
  ACTIVE = 'active',
  EXPIRED = 'expired',
}

/** 解锁关系状态机（§6.1，D3/D7） */
export enum UnlockStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

/** 解锁支付方式（§7 unlock_record.pay_type） */
export enum UnlockPayType {
  QUOTA = 'quota',
  ONCE = 'once',
  COUPON = 'coupon',
}

/** 认证类型（§7 certification.type） */
export enum CertType {
  ID_CARD_OCR = 'id_card_ocr',
  FACE = 'face',
}

/** 档案审核状态（§7 profile.audit_status / cert_status） */
export enum AuditStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** 订单类型（§7 order.type） */
export enum OrderType {
  MEMBER = 'member',
  UNLOCK_ONCE = 'once',
  UNLOCK_REFUND = 'unlock_refund',
  MEMBER_REFUND = 'member_refund',
}

export enum PayStatus {
  CREATED = 'created',
  PAID = 'paid',
  CLOSED = 'closed',
}

export enum RefundStatus {
  NONE = 'none',
  REQUESTED = 'requested',
  REFUNDING = 'refunding',
  REFUNDED = 'refunded',
  REJECTED = 'rejected',
}

/** 消息类型（§5.6 / §7 message.type） */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'img',
  SYSTEM = 'system',
  CONTACT_CARD = 'contact_card',
}

/** 接触升级动作（§5.6，留痕用于退款判定 D7） */
export enum ContactAction {
  EXCHANGE_WECHAT = 'exchange_wechat',
  CALL_PHONE = 'call_phone',
  SEND_PHOTO = 'send_photo',
}

/** 工单类型（§7 ticket.type） */
export enum TicketType {
  FEEDBACK = 'feedback',
  COMPLAINT = 'complaint',
  REPORT = 'report',
  REFUND = 'refund',
}

export enum TicketStatus {
  OPEN = 'open',
  PROCESSING = 'processing',
  CLOSED = 'closed',
}

/** 运营位类型（§7 ops_slot.type） */
export enum OpsSlotType {
  BANNER = 'banner',
  POPUP = 'popup',
  TAB_CENTER = 'tab_center',
}

/** reward_config key 清单（PRD §11，禁止硬编码 —— 取值一律走配置中心） */
export const ConfigKeys = {
  UNLOCK_ONCE_PRICE: 'unlock_once_price', // 单次解锁价（默认分单位，勿在代码写 19.9）
  PAID_MEMBER_PLAN: 'paid_member_plan', // 付费套餐与额度
  NEWBIE_REWARD: 'newbie_reward', // 赠送时长/额度
  INVITE_REWARD: 'invite_reward', // 邀请奖励
  AGE_WINDOW: 'age_window', // 年龄窗 ±10
  RANDOM_RATIO: 'random_ratio', // 随机坑位比 50%
  ROTATION_RATIO: 'rotation_ratio', // 轮换比 30%
  FEED_WEIGHTS: 'feed_weights', // 各项权重分
  COPYWRITING: 'copywriting', // 话术开关与文案
  REMIND_NODES: 'remind_nodes', // 提醒节点 2/7 天
  BIG_PAY_THRESHOLD: 'big_pay_threshold', // 大额支付阈值 500 元（分为单位存）
  COUPON_TEMPLATES: 'coupon_templates', // 券模板
  OPS_SLOTS: 'ops_slots', // 运营位内容
} as const;

/** 金额单位：全站以「分」存储与计算，禁止浮点 */
export const CURRENCY_UNIT = 'CENT';
