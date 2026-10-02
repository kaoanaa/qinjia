import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ContactAction } from '@prisma/client';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService, ImCallbackBody } from './chat.service';
import { SendPhotoDto } from './dto/contact.dto';

const parseId = (raw: string, label: string): bigint => {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException(`${label} 非法`);
  }
};

/**
 * 会话与接触升级接口（PRD §5.6）。/im/callback 为腾讯云IM云端回调，无 JWT（IM 服务器调用，
 * 校验靠配置回调地址 + 服务端裁决权限，红线 I3）。
 */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  @UseGuards(JwtAuthGuard)
  listConversations(@CurrentUserId() userId: bigint, @Query('page') page = '1', @Query('size') size = '20') {
    return this.chat.listConversations(userId, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(size) || 20)));
  }

  @Get('im/user-sig')
  @UseGuards(JwtAuthGuard)
  getUserSig(@CurrentUserId() userId: bigint) {
    return this.chat.getUserSig(userId);
  }

  /** IM 云端回调：BeforeSendMsg 鉴权 + 敏感词 + 解锁前明文联系方式拦截（SS 模式核心） */
  @Post('im/callback')
  @HttpCode(200)
  imCallback(@Body() body: ImCallbackBody) {
    return this.chat.handleCallback(body);
  }

  @Post('contact/:profileId/exchange-wechat')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  exchangeWechat(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string) {
    return this.chat.contactAction(userId, parseId(profileId, 'profileId'), ContactAction.EXCHANGE_WECHAT);
  }

  @Post('contact/:profileId/call-phone')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  callPhone(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string) {
    return this.chat.contactAction(userId, parseId(profileId, 'profileId'), ContactAction.CALL_PHONE);
  }

  @Post('contact/:profileId/send-photo')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  sendPhoto(@CurrentUserId() userId: bigint, @Param('profileId') profileId: string, @Body() dto: SendPhotoDto) {
    return this.chat.contactAction(userId, parseId(profileId, 'profileId'), ContactAction.SEND_PHOTO, dto.photoIndex);
  }

  /** 留痕查询（退款判定 D7 入口） */
  @Get('conversations/:convId/contact-actions')
  @UseGuards(JwtAuthGuard)
  contactActions(@CurrentUserId() userId: bigint, @Param('convId') convId: string) {
    return this.chat.contactActionLogs(userId, parseId(convId, 'convId'));
  }
}
