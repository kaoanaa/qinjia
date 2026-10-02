import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * 单例 PrismaClient。
 * 开发/测试便捷：未配置 DATABASE_URL 时不建连（业务模块接入时需自行保证 env 存在）。
 * FEFO 行锁（§6.1）通过 $transaction + $queryRaw 使用本 client，禁止绕过。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  constructor(private readonly config: ConfigService) {
    super({ log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }] } as never);
  }

  async onModuleInit() {
    if (!this.config.get<string>('DATABASE_URL')) {
      this.logger.warn('DATABASE_URL 未配置，Prisma 跳过连接（仅限脚手架阶段）');
      return;
    }
    await this.$connect();
    this.connected = true;
  }

  async onModuleDestroy() {
    if (this.connected) await this.$disconnect();
  }
}
