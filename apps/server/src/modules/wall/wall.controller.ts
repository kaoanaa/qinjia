import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WallService } from './wall.service';

/** 三大墙 + 三记录 + 精准搜索（契约 docs/openapi.yaml /walls /records /search，Step 16） */
@Controller()
@UseGuards(JwtAuthGuard)
export class WallController {
  constructor(private readonly walls: WallService) {}

  @Get('walls/:wallType')
  wall(@CurrentUserId() userId: bigint, @Param('wallType') wallType: string) {
    return this.walls.wall(userId, wallType);
  }

  @Get('records/:recordType')
  records(@CurrentUserId() userId: bigint, @Param('recordType') recordType: string, @Query('page') page = '1', @Query('size') size = '20') {
    return this.walls.records(userId, recordType, this.clamp(page, 1), this.clamp(size, 20, 50));
  }

  @Get('search')
  search(
    @CurrentUserId() userId: bigint,
    @Query('city') city?: string,
    @Query('ageMin') ageMin?: string,
    @Query('ageMax') ageMax?: string,
    @Query('heightMin') heightMin?: string,
    @Query('heightMax') heightMax?: string,
    @Query('education') education?: string,
    @Query('incomeRange') incomeRange?: string,
    @Query('gender') gender?: string,
    @Query('page') page = '1',
    @Query('size') size = '20',
  ) {
    const num = (v?: string) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.floor(Number(v)) : undefined);
    return this.walls.search(userId, {
      city,
      ageMin: num(ageMin),
      ageMax: num(ageMax),
      heightMin: num(heightMin),
      heightMax: num(heightMax),
      education,
      incomeRange,
      gender,
      page: this.clamp(page, 1),
      size: this.clamp(size, 20, 50),
    });
  }

  private clamp(v: string, def: number, max = 1000): number {
    const n = Number(v);
    return Math.min(max, Math.max(1, Number.isFinite(n) ? Math.floor(n) || def : def));
  }
}
