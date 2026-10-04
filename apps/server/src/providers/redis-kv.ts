import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { KvCache } from './interfaces';

/** Redis 实现（REDIS_URL 存在时启用）；key 前缀统一 qj: */
@Injectable()
export class RedisKvCache implements KvCache, OnModuleDestroy {
  private readonly logger = new Logger(RedisKvCache.name);
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.client.on('error', (e) => this.logger.warn(`redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    this.client.disconnect(); // 否则测试进程不退出（open handle）
  }

  async get(key: string) {
    return this.client.get(`qj:${key}`);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.client.set(`qj:${key}`, value, 'EX', ttlSeconds);
  }

  async del(key: string) {
    await this.client.del(`qj:${key}`);
  }

  async incr(key: string, ttlSeconds: number) {
    const k = `qj:${key}`;
    const n = await this.client.incr(k); // 原子自增
    if (n === 1) await this.client.expire(k, ttlSeconds); // 首窗口设 TTL
    return n;
  }
}
