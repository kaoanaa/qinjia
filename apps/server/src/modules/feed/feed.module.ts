import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { FeedController } from './feed.controller';
import { FeedRotationJob } from './feed-rotation.job';
import { FeedService } from './feed.service';

@Module({
  imports: [ProfileModule],
  controllers: [FeedController],
  providers: [FeedService, FeedRotationJob],
  exports: [FeedService],
})
export class FeedModule {}
