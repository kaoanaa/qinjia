import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Inject } from '@nestjs/common';
import { WX_PAY, WxPay } from '../../providers/interfaces';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    @Inject(WX_PAY) private readonly wxpay: WxPay,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  create(@CurrentUserId() userId: bigint, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(userId, dto);
  }

  /**
   * 微信支付结果通知（免鉴权，微信验签为准）。
   * mock 环境 parsePayCallback 不支持真实报文，测试可直接调用 OrderService.handlePaidCallback。
   */
  @Post('callback/wxpay')
  @HttpCode(200)
  async wxpayCallback(@Req() req: Request, @Headers() headers: Record<string, string>) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    try {
      const parsed = await this.wxpay.parsePayCallback(headers, body);
      if (parsed.success) await this.orders.handlePaidCallback(parsed.outTradeNo, parsed.transactionId);
      return { code: 'SUCCESS' };
    } catch {
      return { code: 'FAIL', message: '回调报文无法解析' };
    }
  }

  @Get(':orderId')
  @UseGuards(JwtAuthGuard)
  get(@CurrentUserId() userId: bigint, @Param('orderId') orderId: string) {
    if (!/^\d+$/.test(orderId)) throw new NotFoundException('订单不存在');
    return this.orders.getOrder(userId, BigInt(orderId));
  }
}
