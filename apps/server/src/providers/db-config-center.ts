import { Injectable } from '@nestjs/common';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigCenter } from './interfaces';

/**
 * 配置中心真实实现（§3.5 / 红线 I1）：reward_config 表为唯一真源。
 * 缺失 key 直接抛错——不允许业务代码用默认值兜底掩盖配置缺失。
 */
@Injectable()
export class DbConfigCenter implements ConfigCenter {
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: (typeof ConfigKeys)[keyof typeof ConfigKeys]): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;

    const row = await this.prisma.rewardConfig.findUnique({ where: { configKey: key } });
    if (!row) {
      throw new Error(`reward_config 缺失配置项: ${key}（请检查 seed/后台配置，业务禁止默认值兜底）`);
    }
    this.cache.set(key, { value: row.value, expiresAt: Date.now() + DbConfigCenter.TTL_MS });
    return row.value as T;
  }

  /** 后台保存配置后主动失效（Step 13 调用） */
  invalidate(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
