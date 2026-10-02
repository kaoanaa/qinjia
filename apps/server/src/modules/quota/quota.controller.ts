import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuotaService } from './quota.service';

@Controller('quota')
@UseGuards(JwtAuthGuard)
export class QuotaController {
  constructor(private readonly quota: QuotaService) {}

  /** 额度余额（FEFO 批次明细 + 汇总，D11/D12；未实名批次计 frozenTotal） */
  @Get('balance')
  balance(@CurrentUserId() userId: bigint) {
    return this.quota.getBalance(userId);
  }
}
