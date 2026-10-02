import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { PublishProfileDto } from './dto/publish-profile.dto';
import { SwitchActiveDto } from './dto/switch-active.dto';
import { MaritalProofDto } from './dto/marital-proof.dto';

/** profileId 非数字视为不存在（防探测） */
function parseId(raw: string): bigint {
  if (!/^\d+$/.test(raw)) throw new NotFoundException('档案不存在');
  return BigInt(raw);
}

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  list(@CurrentUserId() userId: bigint) {
    return this.service.listMine(userId);
  }

  @Post()
  create(@CurrentUserId() userId: bigint, @Body() dto: UpsertProfileDto) {
    return this.service.create(userId, dto);
  }

  @Get('active')
  getActive(@CurrentUserId() userId: bigint) {
    return this.service.getActiveView(userId);
  }

  @Put('active')
  switchActive(@CurrentUserId() userId: bigint, @Body() dto: SwitchActiveDto) {
    return this.service.switchActive(userId, BigInt(dto.profileId));
  }

  @Get(':profileId')
  getOne(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string) {
    return this.service.getMineView(userId, parseId(profileId));
  }

  @Put(':profileId')
  update(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string, @Body() dto: UpsertProfileDto) {
    return this.service.update(userId, parseId(profileId), dto);
  }

  @Post(':profileId/publish')
  @HttpCode(200)
  publish(
    @CurrentUserId() userId: bigint,
    @Param('profileId') profileId: string,
    @Req() req: Request,
    @Body() dto: PublishProfileDto,
  ) {
    return this.service.publish(userId, parseId(profileId), dto, req.ip ?? '');
  }

  @Post(':profileId/marital-proof')
  @HttpCode(200)
  maritalProof(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string, @Body() dto: MaritalProofDto) {
    return this.service.attachMaritalProof(userId, parseId(profileId), dto.objectKeys);
  }
}
