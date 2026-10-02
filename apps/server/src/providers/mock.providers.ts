import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ConfigCenter,
  ImProvider,
  RealnameProvider,
  SmsProvider,
  StorageProvider,
  WechatAuth,
  WxPay,
} from './interfaces';

/**
 * MOCK 实现（development/test 默认）。
 * 行为约定：一切"成功"路径可直接走通，供业务流自测；
 * 失败/回调场景由测试通过覆盖 provider 方法模拟。
 */

@Injectable()
export class MockWechatAuth implements WechatAuth {
  private readonly logger = new Logger(MockWechatAuth.name);

  async code2session(code: string) {
    this.logger.debug(`mock code2session: ${code}`);
    return { openid: `mock_openid_${code}`, sessionKey: 'mock_session_key' };
  }

  async getPhoneNumber(phoneCode: string) {
    return { phoneNumber: `130${phoneCode.padEnd(8, '0').slice(0, 8)}` };
  }

  async sendSubscribeMsg() {
    this.logger.debug('mock subscribe msg sent');
  }
}

@Injectable()
export class MockWxPay implements WxPay {
  private readonly logger = new Logger(MockWxPay.name);

  async createJsapiOrder(params: { outTradeNo: string; amountCent: number; description: string; openid: string }) {
    return {
      prepayId: `mock_prepay_${params.outTradeNo}`,
      paySignParams: { timeStamp: String(Date.now()), nonceStr: 'mock', package: 'prepay_id=mock', signType: 'RSA', paySign: 'mock' },
    };
  }

  async parsePayCallback(_headers: Record<string, string>, _body: string): Promise<{
    outTradeNo: string;
    transactionId: string;
    success: boolean;
    amountCent: number;
  }> {
    throw new Error('MockWxPay.parsePayCallback: 请在测试中直接调用 OrderService.handlePaidCallback(outTradeNo, transactionId)');
  }

  async refund(params: { outTradeNo: string; outRefundNo: string }) {
    this.logger.debug(`mock refund: ${params.outTradeNo}`);
    return { refundId: `mock_refund_${params.outRefundNo}`, status: 'SUCCESS' };
  }

  async downloadBill(date: string) {
    return [`mock_bill_row_${date}`];
  }
}

@Injectable()
export class MockIm implements ImProvider {
  async accountImport() {}
  async addFriend() {}
  async forbidSend() {}
  async sendSystemMsg() {}
}

@Injectable()
export class MockRealname implements RealnameProvider {
  async idCardOcr(imageUrl: string) {
    const hash = `mock_sha256_${imageUrl.slice(-8)}`;
    return { name: '测试用户', idCardNoMasked: '3301**********1234', idCardNoHash: hash, gender: '女', birthYear: 1970 };
  }

  async faceVerify() {
    return { passed: true, verifyToken: 'mock_verify_token' };
  }
}

@Injectable()
export class MockSms implements SmsProvider {
  /** mock 固定验证码 123456，便于全流程自测 */
  static readonly FIXED_CODE = '123456';

  async sendCode(phone: string, scene: string) {
    new Logger(MockSms.name).debug(`mock sms -> ${phone} scene=${scene} code=${MockSms.FIXED_CODE}`);
    return { ttlSeconds: 300 };
  }

  async verifyCode(_phone: string, _scene: string, code: string) {
    return code === MockSms.FIXED_CODE;
  }
}

@Injectable()
export class MockStorage implements StorageProvider {
  async putPrivate(bucket: string, buffer: Buffer) {
    const key = `${bucket}/mock_${Date.now()}_${buffer.length}.jpg`;
    return { objectKey: key };
  }

  async signedUrl(objectKey: string, ttlSeconds: number) {
    return `https://mock-cdn.local/${objectKey}?e=${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  }

  async createUploadToken(bucket: 'photos' | 'marital_proof' | 'id_card', mime: string) {
    const ext = mime.includes('png') ? 'png' : 'jpg';
    return {
      objectKey: `${bucket}/mock_${randomUUID()}.${ext}`,
      uploadUrl: `https://mock-oss.local/put?bucket=${bucket}`,
      expiresAt: new Date(Date.now() + 900_000),
    };
  }
}

@Injectable()
export class MockConfigCenter implements ConfigCenter {
  /** Step 2 前用静态默认值兜底（注意：这些默认值只允许存在于 mock/seed，业务代码禁止硬编码） */
  private readonly defaults: Record<string, unknown> = {
    unlock_once_price: { amountCent: 1990 },
    paid_member_plan: { options: [{ planId: 'month', days: 30, quota: 30, amountCent: 9900 }] },
    newbie_reward: { days: 7, quota: 10 },
    invite_reward: { days: 7, quota: 10 },
    age_window: { minAge: 18, maxAge: 60, diffYears: 10 },
    random_ratio: { percent: 50 },
    rotation_ratio: { percent: 30 },
    feed_weights: { sameCity: 30, sameDistrict: 10, eduMatch: 10, incomeOverlap: 10, active7d: 15, fresh48h: 20, maritalVerified: 30, maritalUnverified: -20 },
    copywriting: { rotationCardTip: '明天起将无法查看对方资料', unlockedContactTip: '对方联系方式' },
    remind_nodes: { trialBeforeDays: 2, paidBeforeDays: 7 },
    big_pay_threshold: { amountCent: 50000 },
    coupon_templates: [],
    ops_slots: [],
  };

  async get<T>(key: string) {
    return this.defaults[key] as T;
  }
}
