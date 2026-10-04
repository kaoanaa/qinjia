import { forwardRef, Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { QuotaModule } from '../quota/quota.module';
import { UnlockModule } from '../unlock/unlock.module';
import { MiscModule } from '../misc/misc.module';
import { OrderController } from './order.controller';
import { MemberController } from './member.controller';
import { CouponController } from './coupon.controller';
import { OrderService } from './order.service';
import { PaymentReconciliationJob } from './payment-reconciliation.job';
import { MemberRemindJob } from './member-remind.job';

@Module({
  imports: [ProfileModule, QuotaModule, MiscModule, forwardRef(() => UnlockModule)],
  controllers: [OrderController, MemberController, CouponController],
  providers: [OrderService, PaymentReconciliationJob, MemberRemindJob],
  exports: [OrderService],
})
export class OrderModule {}
