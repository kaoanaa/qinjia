import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AdminContext, AdminJwtAuthGuard, CurrentAdmin, Roles } from './admin-auth';
import { AdminService } from './admin.service';
import { AdminLoginDto, AuditDecisionDto, CertReviewDto, ConfigUpdateDto, ManagerLeadAssignDto, OpsSlotUpsertDto, RefundDecisionDto, TicketUpdateDto } from './dto/admin.dto';

/**
 * 管理后台（PRD §5.13）。路由前缀 /admin/v1（main.ts 全局前缀已排除 admin 段）。
 * 除登录外全部走 AdminJwtAuthGuard（独立受众 admin-console）。
 */
@Controller('admin/v1')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly guard: AdminJwtAuthGuard,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto) {
    const admin = await this.admin.login(dto.username, dto.password);
    if (!admin) throw new UnauthorizedException('账号或密码错误');
    return { token: this.guard.sign({ id: admin.id, username: admin.username, role: admin.role }), role: admin.role };
  }

  // ==================== 审核工作台 ====================

  @Get('audit/profiles')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'REVIEWER')
  listAuditProfiles(@Query('status') status: string | undefined, @Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listAuditProfiles(status, Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Post('audit/profiles/:profileId')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'REVIEWER')
  @HttpCode(200)
  auditProfile(@CurrentAdmin() admin: AdminContext, @Param('profileId') profileId: string, @Body() dto: AuditDecisionDto) {
    return this.admin.auditProfile(admin, BigInt(profileId), dto);
  }

  @Get('audit/certifications')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'REVIEWER')
  listCertifications(@Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listCertifications(Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Post('audit/certifications/:certId')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'REVIEWER')
  @HttpCode(200)
  reviewCertification(@CurrentAdmin() admin: AdminContext, @Param('certId') certId: string, @Body() dto: CertReviewDto) {
    return this.admin.reviewCertification(admin, BigInt(certId), dto);
  }

  // ==================== 用户 / 额度 / 订单 ====================

  @Get('users')
  @UseGuards(AdminJwtAuthGuard)
  listUsers(@Query('keyword') keyword: string | undefined, @Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listUsers(keyword, Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Get('quotas')
  @UseGuards(AdminJwtAuthGuard)
  listQuotas(@Query('userId') userId: string | undefined, @Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listQuotas(userId ? BigInt(userId) : undefined, Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Get('orders')
  @UseGuards(AdminJwtAuthGuard)
  listOrders(@Query('payStatus') payStatus: string | undefined, @Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listOrders(payStatus, Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Post('orders/:orderId/refund')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'FINANCE')
  @HttpCode(200)
  refundOrder(@CurrentAdmin() admin: AdminContext, @Param('orderId') orderId: string, @Body() dto: RefundDecisionDto) {
    if (!/^\d{1,19}$/.test(orderId)) throw new BadRequestException('orderId 非法');
    return this.admin.refundOrder(admin, BigInt(orderId), dto);
  }

  // ==================== 配置中心（红线 I1 唯一写入口） ====================

  @Get('config')
  @UseGuards(AdminJwtAuthGuard)
  listConfigs() {
    return this.admin.listConfigs();
  }

  @Get('config/:key')
  @UseGuards(AdminJwtAuthGuard)
  getConfig(@Param('key') key: string) {
    return this.admin.getConfig(key);
  }

  @Put('config/:key')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER')
  @HttpCode(200)
  updateConfig(@CurrentAdmin() admin: AdminContext, @Param('key') key: string, @Body() dto: ConfigUpdateDto) {
    return this.admin.updateConfig(admin, key, dto.value);
  }

  // ==================== 运营位 ====================

  @Get('ops-slots')
  @UseGuards(AdminJwtAuthGuard)
  listOpsSlots() {
    return this.admin.listOpsSlots();
  }

  @Post('ops-slots')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'OPERATOR')
  @HttpCode(200)
  upsertOpsSlot(@CurrentAdmin() admin: AdminContext, @Body() dto: OpsSlotUpsertDto) {
    return this.admin.upsertOpsSlot(admin, dto);
  }

  // ==================== 工单 ====================

  @Get('tickets')
  @UseGuards(AdminJwtAuthGuard)
  listTickets(@Query('status') status?: string) {
    return this.admin.listTickets(status);
  }

  @Put('tickets/:ticketId')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(200)
  updateTicket(@CurrentAdmin() admin: AdminContext, @Param('ticketId') ticketId: string, @Body() dto: TicketUpdateDto) {
    return this.admin.updateTicket(admin, BigInt(ticketId), dto);
  }

  // ==================== 管家留资派单（D6） ====================

  @Get('manager-leads')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'OPERATOR')
  listManagerLeads(@Query('status') status: string | undefined, @Query('page') page = '1', @Query('size') size = '20') {
    if (status && !['NEW', 'ASSIGNED', 'FOLLOWING', 'DONE'].includes(status)) throw new BadRequestException('status 非法');
    return this.admin.listManagerLeads(status, Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Post('manager-leads/:leadId/assign')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'OPERATOR')
  @HttpCode(200)
  assignManagerLead(@CurrentAdmin() admin: AdminContext, @Param('leadId') leadId: string, @Body() dto: ManagerLeadAssignDto) {
    if (!/^\d{1,19}$/.test(leadId)) throw new BadRequestException('leadId 非法');
    return this.admin.assignManagerLead(admin, BigInt(leadId), BigInt(dto.managerId));
  }

  @Put('manager-leads/:leadId/status')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER', 'OPERATOR')
  @HttpCode(200)
  updateManagerLeadStatus(@CurrentAdmin() admin: AdminContext, @Param('leadId') leadId: string, @Body('status') status: string) {
    if (!/^\d{1,19}$/.test(leadId)) throw new BadRequestException('leadId 非法');
    return this.admin.updateManagerLeadStatus(admin, BigInt(leadId), status);
  }

  // ==================== IM 风控台 / 看板 ====================

  @Get('im/risk-events')
  @UseGuards(AdminJwtAuthGuard)
  listRiskEvents(@Query('page') page = '1', @Query('size') size = '20') {
    return this.admin.listRiskEvents(Number(page) || 1, Math.min(Number(size) || 20, 100));
  }

  @Get('dashboard/funnel')
  @UseGuards(AdminJwtAuthGuard)
  funnel(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getTime() - 30 * 864e5);
    const toDate = to ? new Date(to) : now;
    return this.admin.funnel(fromDate, toDate);
  }

  @Post('reconciliation/run')
  @UseGuards(AdminJwtAuthGuard)
  @Roles('SUPER')
  @HttpCode(200)
  runReconciliation(@CurrentAdmin() admin: AdminContext, @Query('date') date?: string) {
    return this.admin.runReconciliation(admin, date);
  }
}
