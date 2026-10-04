import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InviteService } from './invite.service';

@Controller('invite')
@UseGuards(JwtAuthGuard)
export class InviteController {
  constructor(private readonly invite: InviteService) {}

  @Get('info')
  info(@CurrentUserId() userId: bigint) {
    return this.invite.info(userId);
  }

  @Post('poster')
  @HttpCode(200)
  poster(@CurrentUserId() userId: bigint) {
    return this.invite.poster(userId);
  }
}
