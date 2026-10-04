import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MiscService } from './misc.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateNotifyPrefDto } from './dto/notify-pref.dto';
import { AddBlacklistDto } from './dto/blacklist.dto';
import { UpdatePrivacyDto } from './dto/privacy.dto';
import { AccountCloseDto } from './dto/account-close.dto';

/**
 * 消息中心/工单/设置/运营位（Step 12，契约 docs/openapi.yaml misc 段）。
 * /ops/slots 契约 security: []（未登录可见 Banner），其余需 JWT。
 */
@Controller()
export class MiscController {
  constructor(private readonly misc: MiscService) {}

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  listNotifications(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '20') {
    return this.misc.listNotifications(userId, this.clamp(page, 1), this.clamp(size, 20, 100));
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  readAll(@CurrentUserId() userId: bigint) {
    return this.misc.readAllNotifications(userId);
  }

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  createTicket(@CurrentUserId() userId: bigint, @Body() dto: CreateTicketDto) {
    return this.misc.createTicket(userId, dto);
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  myTickets(@CurrentUserId() userId: bigint) {
    return this.misc.listMyTickets(userId);
  }

  @Get('settings/notify')
  @UseGuards(JwtAuthGuard)
  getNotify(@CurrentUserId() userId: bigint) {
    return this.misc.getNotifySettings(userId);
  }

  @Put('settings/notify')
  @UseGuards(JwtAuthGuard)
  putNotify(@CurrentUserId() userId: bigint, @Body() dto: UpdateNotifyPrefDto) {
    return this.misc.updateNotifySettings(userId, dto);
  }

  @Get('ops/slots')
  listOpsSlots(@Query('type') type?: string) {
    if (type && !['BANNER', 'POPUP', 'TAB_CENTER'].includes(type)) throw new BadRequestException('type 非法');
    return this.misc.listOpsSlots(type);
  }

  @Put('settings/privacy')
  @UseGuards(JwtAuthGuard)
  putPrivacy(@CurrentUserId() userId: bigint, @Body() dto: UpdatePrivacyDto) {
    return this.misc.updatePrivacy(userId, dto);
  }

  @Get('settings/realname')
  @UseGuards(JwtAuthGuard)
  getRealname(@CurrentUserId() userId: bigint) {
    return this.misc.getRealnameInfo(userId);
  }

  @Post('settings/account-close')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  closeAccount(@CurrentUserId() userId: bigint, @Body() dto: AccountCloseDto) {
    return this.misc.closeAccount(userId, dto);
  }

  @Get('settings/consents')
  @UseGuards(JwtAuthGuard)
  listConsents(@CurrentUserId() userId: bigint) {
    return this.misc.listConsents(userId);
  }

  @Delete('settings/consents/:id')
  @UseGuards(JwtAuthGuard)
  revokeConsent(@CurrentUserId() userId: bigint, @Param('id') id: string) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('id 非法');
    return this.misc.revokeConsent(userId, BigInt(id));
  }

  @Get('blacklist')
  @UseGuards(JwtAuthGuard)
  listBlacklist(@CurrentUserId() userId: bigint) {
    return this.misc.listBlacklist(userId);
  }

  @Post('blacklist')
  @UseGuards(JwtAuthGuard)
  addBlacklist(@CurrentUserId() userId: bigint, @Body() dto: AddBlacklistDto) {
    return this.misc.addBlacklist(userId, BigInt(dto.blockedUserId));
  }

  private clamp(v: string, def: number, max = 1000): number {
    const n = Number(v);
    return Math.min(max, Math.max(1, Number.isFinite(n) ? Math.floor(n) || def : def));
  }
}
