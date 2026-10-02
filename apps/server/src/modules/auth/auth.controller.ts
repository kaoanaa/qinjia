import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUserId } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bind-phone')
  bindPhone(@CurrentUserId() userId: bigint, @Body() dto: BindPhoneDto) {
    return this.auth.bindPhone(userId, dto.phoneCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUserId() userId: bigint) {
    return this.auth.me(userId);
  }
}
