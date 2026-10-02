import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { QuotaModule } from './modules/quota/quota.module';
import { ProfileModule } from './modules/profile/profile.module';
import { CertModule } from './modules/cert/cert.module';
import { UnlockModule } from './modules/unlock/unlock.module';
import { FeedModule } from './modules/feed/feed.module';
import { OrderModule } from './modules/order/order.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
      },
    }),
    HealthModule,
    PrismaModule,
    ProvidersModule,
    AuthModule,
    QuotaModule,
    ProfileModule,
    CertModule,
    UnlockModule,
    OrderModule,
    FeedModule,
  ],
})
export class AppModule {}
