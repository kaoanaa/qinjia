import { Global, Module } from '@nestjs/common';
import {
  CONFIG_CENTER,
  IM,
  REALNAME,
  SMS,
  STORAGE,
  WECHAT_AUTH,
  WX_PAY,
} from './interfaces';
import {
  MockConfigCenter,
  MockIm,
  MockRealname,
  MockSms,
  MockStorage,
  MockWechatAuth,
  MockWxPay,
} from './mock.providers';

/**
 * Provider 注册表：MOCK_PROVIDERS=true（默认）时全部走 mock。
 * 接入真实实现后：在此按 env 切换 useClass，业务代码零改动。
 */
@Global()
@Module({
  providers: [
    { provide: WECHAT_AUTH, useClass: MockWechatAuth },
    { provide: WX_PAY, useClass: MockWxPay },
    { provide: IM, useClass: MockIm },
    { provide: REALNAME, useClass: MockRealname },
    { provide: SMS, useClass: MockSms },
    { provide: STORAGE, useClass: MockStorage },
    { provide: CONFIG_CENTER, useClass: MockConfigCenter },
  ],
  exports: [WECHAT_AUTH, WX_PAY, IM, REALNAME, SMS, STORAGE, CONFIG_CENTER],
})
export class ProvidersModule {}
