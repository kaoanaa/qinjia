import { Module } from '@nestjs/common';
import { CertController } from './cert.controller';
import { ConsentController } from './consent.controller';
import { CertService } from './cert.service';
import { ReferralRewardTrigger } from './referral-reward-trigger';
import { ConsentService } from './consent.service';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [QuotaModule],
  controllers: [CertController, ConsentController],
  providers: [CertService, ConsentService, ReferralRewardTrigger],
  exports: [ReferralRewardTrigger],
})
export class CertModule {}
