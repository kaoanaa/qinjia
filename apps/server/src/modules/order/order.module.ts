import { forwardRef, Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { QuotaModule } from '../quota/quota.module';
import { UnlockModule } from '../unlock/unlock.module';
import { OrderController } from './order.controller';
import { MemberController } from './member.controller';
import { OrderService } from './order.service';
import { PaymentReconciliationJob } from './payment-reconciliation.job';

@Module({
  imports: [ProfileModule, QuotaModule, forwardRef(() => UnlockModule)],
  controllers: [OrderController, MemberController],
  providers: [OrderService, PaymentReconciliationJob],
  exports: [OrderService],
})
export class OrderModule {}
