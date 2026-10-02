/**
 * 完美亲家 · 全局枚举与常量（与 PRD §7 数据模型对齐）
 * 三端共用：miniapp / server / admin
 */
/** 代理人与主体的关系（D1） */
export var Relation;
(function (Relation) {
    Relation["FATHER"] = "father";
    Relation["MOTHER"] = "mother";
    Relation["SELF"] = "self";
})(Relation || (Relation = {}));
/** 用户会员等级 */
export var MemberLevel;
(function (MemberLevel) {
    MemberLevel["NONE"] = "none";
    MemberLevel["TRIAL"] = "trial";
    MemberLevel["PAID"] = "paid";
    MemberLevel["INTENTION"] = "intention";
})(MemberLevel || (MemberLevel = {}));
/** 额度来源（§7 member_quota.source） */
export var QuotaSource;
(function (QuotaSource) {
    QuotaSource["NEWBIE"] = "newbie";
    QuotaSource["INVITE"] = "invite";
    QuotaSource["PAID"] = "paid";
})(QuotaSource || (QuotaSource = {}));
/** 额度状态（D9：实名前 frozen） */
export var QuotaStatus;
(function (QuotaStatus) {
    QuotaStatus["FROZEN"] = "frozen";
    QuotaStatus["ACTIVE"] = "active";
    QuotaStatus["EXPIRED"] = "expired";
})(QuotaStatus || (QuotaStatus = {}));
/** 解锁关系状态机（§6.1，D3/D7） */
export var UnlockStatus;
(function (UnlockStatus) {
    UnlockStatus["ACTIVE"] = "active";
    UnlockStatus["EXPIRED"] = "expired";
    UnlockStatus["REFUNDED"] = "refunded";
})(UnlockStatus || (UnlockStatus = {}));
/** 解锁支付方式（§7 unlock_record.pay_type） */
export var UnlockPayType;
(function (UnlockPayType) {
    UnlockPayType["QUOTA"] = "quota";
    UnlockPayType["ONCE"] = "once";
    UnlockPayType["COUPON"] = "coupon";
})(UnlockPayType || (UnlockPayType = {}));
/** 认证类型（§7 certification.type） */
export var CertType;
(function (CertType) {
    CertType["ID_CARD_OCR"] = "id_card_ocr";
    CertType["FACE"] = "face";
})(CertType || (CertType = {}));
/** 档案审核状态（§7 profile.audit_status / cert_status） */
export var AuditStatus;
(function (AuditStatus) {
    AuditStatus["DRAFT"] = "draft";
    AuditStatus["PENDING"] = "pending";
    AuditStatus["APPROVED"] = "approved";
    AuditStatus["REJECTED"] = "rejected";
})(AuditStatus || (AuditStatus = {}));
/** 订单类型（§7 order.type） */
export var OrderType;
(function (OrderType) {
    OrderType["MEMBER"] = "member";
    OrderType["UNLOCK_ONCE"] = "once";
    OrderType["UNLOCK_REFUND"] = "unlock_refund";
    OrderType["MEMBER_REFUND"] = "member_refund";
})(OrderType || (OrderType = {}));
export var PayStatus;
(function (PayStatus) {
    PayStatus["CREATED"] = "created";
    PayStatus["PAID"] = "paid";
    PayStatus["CLOSED"] = "closed";
})(PayStatus || (PayStatus = {}));
export var RefundStatus;
(function (RefundStatus) {
    RefundStatus["NONE"] = "none";
    RefundStatus["REQUESTED"] = "requested";
    RefundStatus["REFUNDING"] = "refunding";
    RefundStatus["REFUNDED"] = "refunded";
    RefundStatus["REJECTED"] = "rejected";
})(RefundStatus || (RefundStatus = {}));
/** 消息类型（§5.6 / §7 message.type） */
export var MessageType;
(function (MessageType) {
    MessageType["TEXT"] = "text";
    MessageType["IMAGE"] = "img";
    MessageType["SYSTEM"] = "system";
    MessageType["CONTACT_CARD"] = "contact_card";
})(MessageType || (MessageType = {}));
/** 接触升级动作（§5.6，留痕用于退款判定 D7） */
export var ContactAction;
(function (ContactAction) {
    ContactAction["EXCHANGE_WECHAT"] = "exchange_wechat";
    ContactAction["CALL_PHONE"] = "call_phone";
    ContactAction["SEND_PHOTO"] = "send_photo";
})(ContactAction || (ContactAction = {}));
/** 工单类型（§7 ticket.type） */
export var TicketType;
(function (TicketType) {
    TicketType["FEEDBACK"] = "feedback";
    TicketType["COMPLAINT"] = "complaint";
    TicketType["REPORT"] = "report";
    TicketType["REFUND"] = "refund";
})(TicketType || (TicketType = {}));
export var TicketStatus;
(function (TicketStatus) {
    TicketStatus["OPEN"] = "open";
    TicketStatus["PROCESSING"] = "processing";
    TicketStatus["CLOSED"] = "closed";
})(TicketStatus || (TicketStatus = {}));
/** 运营位类型（§7 ops_slot.type） */
export var OpsSlotType;
(function (OpsSlotType) {
    OpsSlotType["BANNER"] = "banner";
    OpsSlotType["POPUP"] = "popup";
    OpsSlotType["TAB_CENTER"] = "tab_center";
})(OpsSlotType || (OpsSlotType = {}));
/** reward_config key 清单（PRD §11，禁止硬编码 —— 取值一律走配置中心） */
export const ConfigKeys = {
    UNLOCK_ONCE_PRICE: 'unlock_once_price', // 单次解锁价（默认分单位，勿在代码写 19.9）
    UNLOCK_VALIDITY: 'unlock_validity', // 解锁有效期（D3 规格默认 30 天，seed §11-14）
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
    IM_CONFIG: 'im_config', // Step 10 Exit：IM 通道与风控（sdkAppId/订阅消息模板 ID/敏感词），模板 ID 进 reward_config
    TICKET_SLA: 'ticket_sla', // Step 12：工单首响 SLA（§6.5/§5.13，默认 48h，禁止代码写死）
};
/** 金额单位：全站以「分」存储与计算，禁止浮点 */
export const CURRENCY_UNIT = 'CENT';
