import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MemberLevel } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, WECHAT_AUTH, WechatAuth } from '../../providers/interfaces';
import { MiscService } from '../misc/misc.service';

interface RemindNodesCfg {
  trialBeforeDays: number;
  paidBeforeDays: number;
}
interface CouponTplCfg {
  name: string;
  scope: 'UNLOCK' | 'MEMBER';
  amountCent: number;
  validDays: number;
  minAmountCent: number;
}
interface PaidPlanCfg {
  intentionUpgradeCouponTemplateId?: string | null;
}

/**
 * 续费提醒节点（PRD §5.11/D10 关联，用例 14，Step 15）：
 * 体验会员到期前 trialBeforeDays 天 → 发续费券（coupon_templates.renew_push_trial）+ 系统消息 + 订阅消息；
 * 付费会员到期前 paidBeforeDays 天 → 续费提醒；配置了诚意会员立减券模板则发 upsell 券。
 * 全部天数/面额/模板/话术读 reward_config（红线 I1）；RemindLog 按（用户,类型,当期到期日）去重。
 */
@Injectable()
export class MemberRemindJob {
  private readonly logger = new Logger(MemberRemindJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly misc: MiscService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(WECHAT_AUTH) private readonly wechat: WechatAuth,
  ) {}

  @Cron('37 9 * * *')
  async handle(): Promise<void> {
    try {
      const r = await this.remindNow();
      if (r.trialReminded || r.paidReminded) this.logger.log(`续费提醒：trial=${r.trialReminded} paid=${r.paidReminded}`);
    } catch (e) {
      this.logger.error(`续费提醒任务异常(不影响主链路)：${(e as Error).message}`);
    }
  }

  /** 供日切测试直接触发；返回统计 */
  async remindNow(): Promise<{ trialReminded: number; paidReminded: number }> {
    const nodes = await this.config.get<RemindNodesCfg>(ConfigKeys.REMIND_NODES);
    const now = new Date();
    let trialReminded = 0;
    let paidReminded = 0;

    trialReminded = await this.remindLevel([MemberLevel.TRIAL], this.plusDays(now, nodes.trialBeforeDays), now, {
      kind: 'TRIAL_RENEW',
      templateKey: 'renewTrial',
      grant: async (userId) => {
        const coupons = await this.config.get<Record<string, CouponTplCfg>>(ConfigKeys.COUPON_TEMPLATES);
        const tpl = coupons?.renew_push_trial;
        if (tpl) await this.grantCoupon(userId, tpl, 'renew_push', now);
      },
    });

    paidReminded = await this.remindLevel([MemberLevel.PAID, MemberLevel.INTENTION], this.plusDays(now, nodes.paidBeforeDays), now, {
      kind: 'PAID_RENEW',
      templateKey: 'renewPaid',
      grant: async (userId) => {
        // 升级 upsell 立减券：模板进 paid_member_plan 配置（P1 可空，红线 I1）
        const plan = await this.config.get<PaidPlanCfg>(ConfigKeys.PAID_MEMBER_PLAN);
        const tplName = plan?.intentionUpgradeCouponTemplateId;
        if (!tplName) return;
        const coupons = await this.config.get<Record<string, CouponTplCfg>>(ConfigKeys.COUPON_TEMPLATES);
        const tpl = coupons?.[tplName];
        if (tpl) await this.grantCoupon(userId, tpl, 'upsell', now);
      },
    });

    return { trialReminded, paidReminded };
  }

  private async remindLevel(
    levels: MemberLevel[],
    windowEnd: Date,
    now: Date,
    opts: { kind: string; templateKey: string; grant: (userId: bigint) => Promise<void> },
  ): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: { memberLevel: { in: levels }, memberExpireAt: { gt: now, lte: windowEnd }, status: 'ACTIVE' },
    });
    const imCfg = await this.config.get<{ subscribeTemplates?: Record<string, string> }>(ConfigKeys.IM_CONFIG);
    const subscribeTpl = imCfg.subscribeTemplates?.renewRemind;
    let sent = 0;
    for (const u of due) {
      // 去重锚：claim 失败=本周期已提醒过
      try {
        await this.prisma.remindLog.create({ data: { userId: u.id, kind: opts.kind, memberExpireAt: u.memberExpireAt as Date } });
      } catch {
        continue;
      }
      await opts.grant(u.id);
      await this.misc.notifyByTemplate(u.id, 'activity', opts.templateKey);
      if (subscribeTpl) {
        try {
          const daysLeft = Math.max(1, Math.ceil(((u.memberExpireAt as Date).getTime() - now.getTime()) / 864e5));
          await this.wechat.sendSubscribeMsg(u.openid, subscribeTpl, { thing1: '会员即将到期', number2: String(daysLeft) }, 'pages/mine/member/index');
        } catch (e) {
          this.logger.warn(`订阅消息失败(旁路) user=${u.id}：${(e as Error).message}`);
        }
      }
      sent += 1;
    }
    return sent;
  }

  /** 券模板配置 → CouponTemplate 行（按名复用）→ 发 UserCoupon */
  private async grantCoupon(userId: bigint, tpl: CouponTplCfg, source: string, now: Date) {
    const row =
      (await this.prisma.couponTemplate.findFirst({ where: { name: tpl.name, status: true } })) ??
      (await this.prisma.couponTemplate.create({
        data: {
          name: tpl.name,
          scope: tpl.scope,
          amountCent: tpl.amountCent,
          minAmountCent: tpl.minAmountCent,
          validDays: tpl.validDays,
          startAt: now,
          endAt: new Date(now.getTime() + tpl.validDays * 864e5),
        },
      }));
    await this.prisma.userCoupon.create({
      data: { templateId: row.id, userId, expireAt: new Date(now.getTime() + tpl.validDays * 864e5), source },
    });
  }

  private plusDays(d: Date, days: number): Date {
    return new Date(d.getTime() + days * 864e5);
  }
}
