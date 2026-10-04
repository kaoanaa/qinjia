import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MiscService } from './misc.service';

/** 注销冷静期到期匿名化（§5.8/PIPL）：每日凌晨清扫到期账号 */
@Injectable()
export class AccountCloseJob {
  private readonly logger = new Logger(AccountCloseJob.name);

  constructor(private readonly misc: MiscService) {}

  @Cron('23 3 * * *')
  async handle(): Promise<void> {
    try {
      await this.misc.anonymizeDue();
    } catch (e) {
      this.logger.error(`注销匿名化任务失败: ${(e as Error).message}`);
    }
  }
}
