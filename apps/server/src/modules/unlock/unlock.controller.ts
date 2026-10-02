import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UnlockService } from './unlock.service';
import { UnlockCheckDto, UnlockDto } from './dto/unlock.dto';

const IDEM_TTL_MS = 15 * 60_000;

/**
 * 解锁接口（PRD §6.1）。Idempotency-Key 必填：同 key 重放返回首次结果（进程内短缓存，
 * 跨实例幂等最终由 unlock_record 唯一约束 + 订单 transactionId 兜底）。
 */
@Controller('unlock')
@UseGuards(JwtAuthGuard)
export class UnlockController {
  private readonly idemCache = new Map<string, { status: number; body: unknown; at: number }>();

  constructor(private readonly unlockService: UnlockService) {}

  /** 解锁前校验（只读不扣费） */
  @Post('check')
  @HttpCode(200)
  check(@CurrentUserId() userId: bigint, @Body() dto: UnlockCheckDto) {
    return this.unlockService.check(userId, BigInt(dto.profileId));
  }

  @Post()
  async unlock(
    @CurrentUserId() userId: bigint,
    @Headers('idempotency-key') idemKey: string | undefined,
    @Body() dto: UnlockDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idemKey?.trim()) throw new BadRequestException('缺少 Idempotency-Key 请求头');
    const cacheKey = `${userId}:${idemKey}`;
    const hit = this.idemCache.get(cacheKey);
    if (hit && Date.now() - hit.at < IDEM_TTL_MS) {
      res.status(hit.status);
      return hit.body;
    }

    const out = await this.unlockService.unlock(userId, {
      profileId: BigInt(dto.profileId),
      riskConfirmed: dto.riskConfirmed ?? false,
      userCouponId: dto.userCouponId ? BigInt(dto.userCouponId) : undefined,
    });

    const cached =
      out.kind === 'unlocked'
        ? { status: 200, body: out.result, at: Date.now() }
        : { status: 202, body: { state: 'need_payment', order: out.order }, at: Date.now() };
    this.sweep();
    this.idemCache.set(cacheKey, cached);
    res.status(cached.status);
    return cached.body;
  }

  @Get('records')
  records(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '20') {
    return this.unlockService.listRecords(userId, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(size) || 20)));
  }

  private sweep() {
    if (this.idemCache.size < 500) return;
    const now = Date.now();
    for (const [k, v] of this.idemCache) if (now - v.at > IDEM_TTL_MS) this.idemCache.delete(k);
  }
}
