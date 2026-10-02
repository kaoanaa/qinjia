import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QuotaService } from './quota.service';

/** 定时任务①（ARCHITECTURE §5）：额度到期清扫。幂等，多实例并发安全（状态机条件更新）。 */
@Injectable()
export class QuotaExpiryJob {
  private readonly logger = new Logger(QuotaExpiryJob.name);

  constructor(private readonly quota: QuotaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle() {
    try {
      await this.quota.expireOverdue();
    } catch (e) {
      this.logger.error(`额度清扫失败: ${(e as Error).message}`);
    }
  }
}
