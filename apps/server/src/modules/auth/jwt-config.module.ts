import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

const DEV_FALLBACK_SECRET = 'dev_only_secret_change_me';

/** JwtService 全局可用（JwtAuthGuard 会被多个模块的 controller 实例化） */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET') ?? DEV_FALLBACK_SECRET;
        if (secret === DEV_FALLBACK_SECRET && config.get('NODE_ENV') === 'production') {
          throw new Error('生产环境必须配置 JWT_SECRET');
        }
        return { secret };
      },
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}
