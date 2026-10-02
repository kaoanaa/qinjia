import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { NotificationCategory, OpsSlotType, Prisma } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter } from '../../providers/interfaces';

interface TicketSlaCfg {
  firstResponseHours: number;
}

const DEFAULT_SWITCHES: Record<string, boolean> = {
  review: true,
  expireRemind: true,
  activity: true,
  rewardArrived: true,
};

/**
 * 消息中心与杂项（PRD §5.12/§5.13，Step 12）：系统消息、工单（SLA 读配置，红线 I1）、
 * 通知开关、运营位（防诈 Banner）。系统消息写入由 cert 解冻/解锁过期等触发方调用 notify()。
 */
@Injectable()
export class MiscService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
  ) {}

  /** 内部触发口：系统消息落库（话术由调用方从 copywriting.notifyTemplates 读取，禁止硬编码） */
  async notify(userId: bigint, category: NotificationCategory, title: string, body: string) {
    return this.prisma.systemNotification.create({ data: { userId, category, title, body } });
  }

  async notifyByTemplate(userId: bigint, category: NotificationCategory, templateKey: string) {
    const copy = await this.config.get<{ notifyTemplates?: Record<string, { title: string; body: string }> }>(ConfigKeys.COPYWRITING);
    const tpl = copy.notifyTemplates?.[templateKey];
    if (!tpl) return null; // 模板未配置：不阻断主流程（触发方均为旁路）
    return this.notify(userId, category, tpl.title, tpl.body);
  }

  // ==================== 系统消息 ====================

  async listNotifications(userId: bigint, page: number, size: number) {
    const [total, unread, rows] = await Promise.all([
      this.prisma.systemNotification.count({ where: { userId } }),
      this.prisma.systemNotification.count({ where: { userId, readFlag: false } }),
      this.prisma.systemNotification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    return {
      total,
      unread,
      items: rows.map((n) => ({
        id: n.id.toString(),
        category: n.category,
        title: n.title,
        body: n.body,
        readFlag: n.readFlag,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async readAllNotifications(userId: bigint) {
    const { count } = await this.prisma.systemNotification.updateMany({ where: { userId, readFlag: false }, data: { readFlag: true } });
    return { updated: count };
  }

  // ==================== 工单（§5.13，SLA 首响读配置） ====================

  async createTicket(userId: bigint, dto: { type: string; content: string; images?: string[]; orderId?: string }) {
    const sla = await this.config.get<TicketSlaCfg>(ConfigKeys.TICKET_SLA);
    const created = await this.prisma.ticket.create({
      data: {
        userId,
        type: dto.type as never,
        content: dto.content,
        images: (dto.images ?? []) as unknown as Prisma.InputJsonValue,
        slaDeadline: new Date(Date.now() + sla.firstResponseHours * 3600_000), // 禁止代码写死 48（I1）
      },
    });
    return this.serializeTicket(created);
  }

  async listMyTickets(userId: bigint) {
    const rows = await this.prisma.ticket.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map((t) => this.serializeTicket(t));
  }

  private serializeTicket(t: { id: bigint; type: string; content: string; status: string; slaDeadline: Date; handlerNote: string | null; createdAt: Date }) {
    return {
      id: t.id.toString(),
      type: t.type,
      content: t.content,
      status: t.status,
      slaDeadline: t.slaDeadline.toISOString(),
      handlerNote: t.handlerNote,
      createdAt: t.createdAt.toISOString(),
    };
  }

  // ==================== 通知设置（我的页开关） ====================

  async getNotifySettings(userId: bigint) {
    const pref = await this.prisma.notifyPref.findUnique({ where: { userId } });
    return {
      switches: { ...DEFAULT_SWITCHES, ...((pref?.switches as Record<string, boolean>) ?? {}) },
      subscribeAuthStatus: pref?.subscribeAuthStatus ?? 'UNKNOWN',
    };
  }

  async updateNotifySettings(userId: bigint, dto: { switches?: Record<string, boolean>; subscribeAuthStatus?: string }) {
    this.assertSwitchValues(dto.switches);
    const existing = await this.prisma.notifyPref.findUnique({ where: { userId } });
    const switches = { ...DEFAULT_SWITCHES, ...((existing?.switches as Record<string, boolean>) ?? {}), ...(dto.switches ?? {}) };
    const subscribeAuthStatus = dto.subscribeAuthStatus ?? existing?.subscribeAuthStatus ?? 'UNKNOWN';
    const pref = await this.prisma.notifyPref.upsert({
      where: { userId },
      create: { userId, switches: switches as object, subscribeAuthStatus: subscribeAuthStatus as never },
      update: { switches: switches as object, subscribeAuthStatus: subscribeAuthStatus as never },
    });
    return { switches, subscribeAuthStatus: pref.subscribeAuthStatus };
  }

  private assertSwitchValues(switches?: Record<string, boolean>) {
    if (switches && Object.values(switches).some((v) => typeof v !== 'boolean')) {
      throw new BadRequestException('switches 的值必须是布尔');
    }
  }

  // ==================== 运营位（防诈 Banner / 倒计时条数据源） ====================

  async listOpsSlots(type?: string) {
    const now = new Date();
    const rows = await this.prisma.opsSlot.findMany({
      where: {
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
        ...(type ? { type: type as OpsSlotType } : {}),
      },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id.toString(),
      type: s.type,
      content: s.content,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      sort: s.sort,
      enabled: s.enabled,
    }));
  }
}
