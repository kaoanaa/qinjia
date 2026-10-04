import { Module } from '@nestjs/common';
import { MiscController } from './misc.controller';
import { MiscService } from './misc.service';
import { AccountCloseJob } from './account-close.job';

@Module({
  controllers: [MiscController],
  providers: [MiscService, AccountCloseJob],
  exports: [MiscService],
})
export class MiscModule {}
