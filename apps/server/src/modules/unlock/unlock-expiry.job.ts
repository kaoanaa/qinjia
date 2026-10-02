import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UnlockService } from './unlock.service';

/** 定时任务②（§6.1/T+30，用例 3）：解锁关系过期清扫。幂等；会话历史保留、消息禁发由 Step 10 IM 回调按状态裁决。 */
@Injectable()
export class UnlockExpiryJob {
  private readonly logger = new Logger(UnlockExpiryJob.name);

  constructor(private readonly unlock: UnlockService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle() {
    try {
      await this.unlock.expireOverdue();
    } catch (e) {
      this.logger.error(`解锁清扫失败: ${(e as Error).message}`);
    }
  }
}
