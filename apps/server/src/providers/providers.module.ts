import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONFIG_CENTER,
  IM,
  REALNAME,
  SMS,
  STORAGE,
  WECHAT_AUTH,
  WX_PAY,
} from './interfaces';
import { DbConfigCenter } from './db-config-center';
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
 * CONFIG_CENTER 例外：DB 配置中心是"真实实现"，由 MOCK_PROVIDERS 切换（红线 I1）。
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: WECHAT_AUTH, useClass: MockWechatAuth },
    { provide: WX_PAY, useClass: MockWxPay },
    { provide: IM, useClass: MockIm },
    { provide: REALNAME, useClass: MockRealname },
    { provide: SMS, useClass: MockSms },
    { provide: STORAGE, useClass: MockStorage },
    {
      provide: CONFIG_CENTER,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) =>
        config.get<string>('MOCK_PROVIDERS', 'true') === 'true'
          ? new MockConfigCenter()
          : new DbConfigCenter(prisma),
    },
  ],
  exports: [WECHAT_AUTH, WX_PAY, IM, REALNAME, SMS, STORAGE, CONFIG_CENTER],
})
export class ProvidersModule {}
