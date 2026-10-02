/**
 * 外部依赖抽象（I7 全局不变量：三端可脱离第三方联调）
 * 真实实现按 Step 逐步替换 mock；接口形状即最终形状。
 */
import { ConfigKeys } from '@qinjia/shared';

export const WECHAT_AUTH = Symbol('WECHAT_AUTH');
export const WX_PAY = Symbol('WX_PAY');
export const IM = Symbol('IM');
export const REALNAME = Symbol('REALNAME');
export const SMS = Symbol('SMS');
export const STORAGE = Symbol('STORAGE');
export const CONFIG_CENTER = Symbol('CONFIG_CENTER');
export const KV_CACHE = Symbol('KV_CACHE');

export interface WechatAuth {
  /** code2session：小程序登录 */
  code2session(code: string): Promise<{ openid: string; unionid?: string; sessionKey: string }>;
  /** 手机号快速验证组件 */
  getPhoneNumber(phoneCode: string): Promise<{ phoneNumber: string }>;
  /** 订阅消息下发（离线通知/提醒节点） */
  sendSubscribeMsg(openid: string, templateId: string, data: Record<string, string>, page?: string): Promise<void>;
}

export interface WxPay {
  /** JSAPI 下单，返回小程序调起支付参数 */
  createJsapiOrder(params: {
    outTradeNo: string;
    amountCent: number; // 全站金额单位为分
    description: string;
    openid: string;
  }): Promise<{ prepayId: string; paySignParams: Record<string, string> }>;
  /** 解密并校验支付回调 */
  parsePayCallback(headers: Record<string, string>, body: string): Promise<{
    outTradeNo: string;
    transactionId: string;
    success: boolean;
    amountCent: number;
  }>;
  /** 原路退款（§6.5） */
  refund(params: { outTradeNo: string; outRefundNo: string; amountCent: number; totalCent: number }): Promise<{ refundId: string; status: string }>;
  /** 下载账单用于日切对账（§6.6） */
  downloadBill(date: string): Promise<string[]>;
}

export interface ImProvider {
  /** 导入/更新 IM 账号 */
  accountImport(userId: string, nickname: string, avatarUrl?: string): Promise<void>;
  /** 解锁成功后建立好友关系并放开聊天权限（§3.4） */
  addFriend(userA: string, userB: string): Promise<void>;
  /** 解锁过期后删除关系/禁言 */
  forbidSend(userA: string, userB: string): Promise<void>;
  /** 发送群系统/全局系统通知 */
  sendSystemMsg(toUserId: string, content: string): Promise<void>;
}

export interface RealnameProvider {
  /** 身份证 OCR，返回脱敏摘要（原文不落库，I5） */
  idCardOcr(imageUrl: string): Promise<{ name: string; idCardNoMasked: string; idCardNoHash: string; gender: string; birthYear: number }>;
  /** 人脸核身结果查询：真实实现按 sessionId(bizId) 向 provider 拉取结论，无需回传证件号（I5） */
  faceVerify(params: { sessionId: string; name?: string; idCardNo?: string }): Promise<{ passed: boolean; verifyToken: string }>;
}

export interface SmsProvider {
  /** 发送验证码：子女授权短信 / 大额支付二次确认 */
  sendCode(phone: string, scene: 'child_consent' | 'big_pay_confirm' | 'login'): Promise<{ ttlSeconds: number }>;
  verifyCode(phone: string, scene: string, code: string): Promise<boolean>;
}

export interface StorageProvider {
  /** 私有桶上传（照片/证明），返回不可枚举 objectKey */
  putPrivate(bucket: 'photos' | 'marital_proof' | 'id_card', buffer: Buffer, mime: string): Promise<{ objectKey: string }>;
  /** 申请直传凭证（/media/upload-token）：服务端预分配 objectKey + 限时 PUT URL */
  createUploadToken(bucket: 'photos' | 'marital_proof' | 'id_card', mime: string): Promise<{ objectKey: string; uploadUrl: string; expiresAt: Date }>;
  /** 生成限时签名 URL（打码图走 CDN 处理参数） */
  signedUrl(objectKey: string, ttlSeconds: number, process?: string): Promise<string>;
}

/** KV 缓存（feed 分页/幂等短存）：REDIS_URL 存在走 Redis，否则内存 mock（CI 无外网） */
export interface KvCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** 配置中心抽象（§3.5，红线 I1：业务代码禁止出现裸数值） */
export interface ConfigCenter {
  get<T = unknown>(key: (typeof ConfigKeys)[keyof typeof ConfigKeys]): Promise<T>;
}
