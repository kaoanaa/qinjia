import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ConsentService } from './consent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ConsentSendSmsDto, ConsentVerifyDto } from './dto/consent.dto';

@Controller('consent')
@UseGuards(JwtAuthGuard)
export class ConsentController {
  constructor(private readonly service: ConsentService) {}

  @Post('send-sms')
  @HttpCode(200)
  sendSms(@CurrentUserId() userId: bigint, @Body() dto: ConsentSendSmsDto) {
    return this.service.sendSms(userId, BigInt(dto.profileId), dto.childPhone);
  }

  @Post('verify')
  @HttpCode(200)
  verify(@CurrentUserId() userId: bigint, @Req() req: Request, @Body() dto: ConsentVerifyDto) {
    return this.service.verify(
      userId,
      BigInt(dto.profileId),
      dto.childPhone,
      dto.code,
      dto.statementAccepted,
      dto.statementVersion,
      req.ip ?? '',
    );
  }
}
