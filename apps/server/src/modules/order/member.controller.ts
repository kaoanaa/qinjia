import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderService } from './order.service';

@Controller('member')
export class MemberController {
  constructor(private readonly orders: OrderService) {}

  /** 在售套餐（公开，读 paid_member_plan 配置） */
  @Get('plans')
  plans() {
    return this.orders.listPlans();
  }

  /** 会员卡（§5.9） */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUserId() userId: bigint) {
    return this.orders.memberCard(userId);
  }
}
