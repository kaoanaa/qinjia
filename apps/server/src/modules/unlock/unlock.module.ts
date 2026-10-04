import { forwardRef, Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { QuotaModule } from '../quota/quota.module';
import { OrderModule } from '../order/order.module';
import { MiscModule } from '../misc/misc.module';
import { UnlockController } from './unlock.controller';
import { UnlockService } from './unlock.service';
import { UnlockExpiryJob } from './unlock-expiry.job';
import { UnlockRateLimitGuard } from './unlock-rate-limit.guard';

@Module({
  imports: [ProfileModule, QuotaModule, MiscModule, forwardRef(() => OrderModule)],
  controllers: [UnlockController],
  providers: [UnlockService, UnlockExpiryJob, UnlockRateLimitGuard],
  exports: [UnlockService],
})
export class UnlockModule {}
