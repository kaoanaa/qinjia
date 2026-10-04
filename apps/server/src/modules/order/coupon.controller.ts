import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserCouponStatus } from '@prisma/client';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderService } from './order.service';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponController {
  constructor(private readonly orders: OrderService) {}

  @Get('mine')
  mine(@CurrentUserId() userId: bigint, @Query('status') status?: UserCouponStatus) {
    return this.orders.listMyCoupons(userId, status);
  }
}
