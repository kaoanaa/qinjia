import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedService } from './feed.service';

/** feed-rotation（ARCHITECTURE 定时任务表）：每日 00:05 生成当日"仅今日"轮换集 */
@Injectable()
export class FeedRotationJob {
  private readonly logger = new Logger(FeedRotationJob.name);

  constructor(private readonly feed: FeedService) {}

  @Cron('5 0 * * *')
  async handle(): Promise<void> {
    try {
      await this.feed.generateDailyRotation();
    } catch (e) {
      this.logger.error(`轮换集生成失败：${(e as Error).message}`); // 吞异常保调度（同 Step 7 约定）
    }
  }
}
