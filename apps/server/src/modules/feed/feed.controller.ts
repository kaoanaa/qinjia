import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedService } from './feed.service';
import { ProfileIdDto } from './dto/profile-id.dto';

/**
 * 推荐流与公开档案接口（契约 docs/openapi.yaml）。注意 favorites/greet 是顶级路径
 * （契约 /api/v1/favorites、/api/v1/greet），故本控制器不加统一前缀。
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /** 首页今日推荐（§5.3）：规则 50% + 随机 50%，轮换卡带"仅今日"标 */
  @Get('feed')
  list(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '10') {
    return this.feed.list(userId, this.clampNum(page, 1, 1, 1000), this.clampNum(size, 10, 1, 50));
  }

  /** 历史推荐（D4/用例 8）：被轮换档案可找回并可解锁 */
  @Get('feed/history')
  history(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '10') {
    return this.feed.history(userId, this.clampNum(page, 1, 1, 1000), this.clampNum(size, 10, 1, 50));
  }

  /** 对方档案详情（§5.4/§6.3）：照片两态 + 警示置顶 + 访问记录 + 上下滑切换 */
  @Get('feed/public/:matchNo')
  publicProfile(@CurrentUserId() userId: bigint, @Param('matchNo') matchNo: string) {
    return this.feed.publicDetail(matchNo, userId);
  }

  /** 转发微信卡片 + 海报数据（§5.4） */
  @Get('feed/public/:matchNo/share')
  share(@CurrentUserId() userId: bigint, @Param('matchNo') matchNo: string) {
    return this.feed.share(matchNo, userId);
  }

  /** 收藏/取消收藏（切换） */
  @Post('favorites')
  @HttpCode(200)
  favorite(@CurrentUserId() userId: bigint, @Body() dto: ProfileIdDto) {
    return this.feed.toggleFavorite(userId, BigInt(dto.profileId));
  }

  /** 打招呼免费破冰（P0 仅系统卡片占位，不建立聊天权限） */
  @Post('greet')
  @HttpCode(200)
  greet(@CurrentUserId() userId: bigint, @Body() dto: ProfileIdDto) {
    return this.feed.greet(userId, BigInt(dto.profileId));
  }

  private clampRaw(v: string, def: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  }

  private clampNum(v: string, def: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.clampRaw(v, def)));
  }
}
