import { Module } from '@nestjs/common';
import { MiscModule } from '../misc/misc.module';
import { UnlockModule } from '../unlock/unlock.module';
import { OrderModule } from '../order/order.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminJwtAuthGuard } from './admin-auth';

/**
 * 管理后台（PRD §5.13，Step 13）。独立账号体系 + 独立 JWT 受众；
 * 依赖 Misc（审核/工单系统消息）、Unlock（违规下架返额度 refundQuotaUnlock）。
 * Prisma/JwtService/CONFIG_CENTER 由全局模块提供。
 */
@Module({
  imports: [MiscModule, UnlockModule, OrderModule],
  controllers: [AdminController],
  providers: [AdminService, AdminJwtAuthGuard],
  exports: [AdminService],
})
export class AdminModule {}
