import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedService } from './feed.service';

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /** 首页今日推荐（§5.3）：规则 50% + 随机 50%，轮换卡带"仅今日"标 */
  @Get()
  list(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '10') {
    return this.feed.list(userId, this.clampNum(page, 1, 1, 1000), this.clampNum(size, 10, 1, 50));
  }

  /** 历史推荐（D4/用例 8）：被轮换档案可找回并可解锁 */
  @Get('history')
  history(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '10') {
    return this.feed.history(userId, this.clampNum(page, 1, 1, 1000), this.clampNum(size, 10, 1, 50));
  }

  private clampRaw(v: string, def: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  }

  private clampNum(v: string, def: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.clampRaw(v, def)));
  }
}
