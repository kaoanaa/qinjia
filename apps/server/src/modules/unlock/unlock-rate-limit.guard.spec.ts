import { ExecutionContext, HttpException } from '@nestjs/common';
import { MockKvCache } from '../../providers/mock.providers';
import { ConfigCenter, KvCache } from '../../providers/interfaces';
import { UnlockRateLimitGuard } from './unlock-rate-limit.guard';

/** 限频守卫单测（§6.6 / 红线 I1）：阈值来自配置而非硬编码；超窗归零；固定窗口计数触发 429 */
describe('UnlockRateLimitGuard', () => {
  function ctxFor(userId: bigint): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => ({ userId }) }) } as ExecutionContext;
  }

  function makeGuard(cfg: { unlockPerMinute: number; windowSeconds: number }, kv: KvCache = new MockKvCache()) {
    const config: ConfigCenter = { get: jest.fn().mockResolvedValue(cfg) };
    return { guard: new UnlockRateLimitGuard(config, kv), config, kv };
  }

  it('未超过每分钟上限放行；达到上限后抛 429', async () => {
    const { guard } = makeGuard({ unlockPerMinute: 2, windowSeconds: 60 });
    const c = ctxFor(42n);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    await expect(guard.canActivate(c)).rejects.toThrow(HttpException);
    await guard.canActivate(c).catch((e: HttpException) => {
      expect(e.getStatus()).toBe(429);
    });
  });

  it('阈值读配置（I1）：不同 limit 生效于不同次数', async () => {
    const kv = new MockKvCache();
    // 桶随 window 归零：此处 window 很大，同桶累加；limit=1 → 第二次即拒
    const { guard, config } = makeGuard({ unlockPerMinute: 1, windowSeconds: 3600 }, kv);
    const c = ctxFor(7n);
    expect(await guard.canActivate(c)).toBe(true);
    await expect(guard.canActivate(c)).rejects.toThrow(HttpException);
    expect(config.get).toHaveBeenCalledWith('rate_limit');
  });

  it('不同用户互不影响（按 userId 分桶）', async () => {
    const { guard } = makeGuard({ unlockPerMinute: 1, windowSeconds: 3600 });
    expect(await guard.canActivate(ctxFor(100n))).toBe(true);
    expect(await guard.canActivate(ctxFor(200n))).toBe(true); // 另一用户首访
    await expect(guard.canActivate(ctxFor(100n))).rejects.toThrow(HttpException);
  });

  it('未认证（无 userId）直接放行，交由 JwtAuthGuard 处理', async () => {
    const { guard } = makeGuard({ unlockPerMinute: 1, windowSeconds: 60 });
    const c = { switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext;
    expect(await guard.canActivate(c)).toBe(true);
  });
});
