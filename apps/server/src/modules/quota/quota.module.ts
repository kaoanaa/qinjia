import { Module } from '@nestjs/common';
import { QuotaController } from './quota.controller';
import { QuotaService } from './quota.service';
import { QuotaExpiryJob } from './quota-expiry.job';

@Module({
  controllers: [QuotaController],
  providers: [QuotaService, QuotaExpiryJob],
  exports: [QuotaService],
})
export class QuotaModule {}
