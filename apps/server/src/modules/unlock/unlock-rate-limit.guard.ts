import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ConfigKeys } from '@qinjia/shared';
import { CONFIG_CENTER, ConfigCenter, KV_CACHE, KvCache } from '../../providers/interfaces';

interface RateLimitCfg {
  unlockPerMinute: number;
  windowSeconds: number;
}

/**
 * 解锁接口限频（§6.6 防刷）：固定窗口计数（KV 原子 incr，Redis 生产 / 内存 mock CI）。
 * 阈值与窗口读 reward_config.rate_limit（红线 I1，禁止代码写死）。超限 → 429。
 * 依赖 JwtAuthGuard 先行注入 req.userId（方法级守卫在类级守卫之后执行）。
 */
@Injectable()
export class UnlockRateLimitGuard implements CanActivate {
  constructor(
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(KV_CACHE) private readonly kv: KvCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: bigint }>();
    const userId = req.userId;
    if (!userId) return true; // 未认证交给 JwtAuthGuard

    // 阈值与窗口严格来自 reward_config.rate_limit（红线 I1：DbConfigCenter 缺 key 即抛错，禁止代码兜底数值）
    const { unlockPerMinute, windowSeconds } = await this.config.get<RateLimitCfg>(ConfigKeys.RATE_LIMIT);
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const count = await this.kv.incr(`rl:unlock:${userId}:${bucket}`, windowSeconds);
    if (count > unlockPerMinute) throw new HttpException('操作过于频繁，请稍后再试', 429);
    return true;
  }
}
