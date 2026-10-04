import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderService } from './order.service';

/**
 * 定时任务③（§6.6 支付对账日切）：每日 03:17 比对昨日微信账单与本地 PAID 订单。
 * 只读对账，差异由 OrderService 打告警日志供人工介入；不自动改账（资金安全）。
 */
@Injectable()
export class PaymentReconciliationJob {
  private readonly logger = new Logger(PaymentReconciliationJob.name);

  constructor(private readonly order: OrderService) {}

  @Cron('17 3 * * *')
  async handle() {
    try {
      const r = await this.order.reconcileDay();
      this.logger.log(`对账日切完成 ${r.date}: 本地${r.localCount}/账单${r.billCount}，差异=${r.missingInBill.length + r.missingInSystem.length + r.amountMismatch.length}`);
    } catch (e) {
      this.logger.error(`支付对账任务失败: ${(e as Error).message}`);
    }
  }
}
