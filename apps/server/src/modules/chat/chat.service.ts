import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContactAction, MessageType, Prisma } from '@prisma/client';
import { ConfigKeys } from '@qinjia/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIG_CENTER, ConfigCenter, IM, ImProvider, STORAGE, StorageProvider, WECHAT_AUTH, WechatAuth } from '../../providers/interfaces';
import { BusinessException } from '../../common/business.exception';
import { ProfileService } from '../profile/profile.service';
import { UnlockService } from '../unlock/unlock.service';

interface ImCopy {
  chatNotUnlockedTip: string;
  chatExpiredSendTip: string;
  chatBlockedContactTip: string;
  chatSensitiveTip: string;
}

interface ImCfg {
  sdkAppId: string;
  subscribeTemplates: { newMessage: string };
  sensitiveWords: string[];
  imageGuardStrategy: string;
}

export interface ImCallbackBody {
  CallbackCommand?: string;
  From_Account?: string;
  To_Account?: string;
  MsgBody?: Array<{ MsgType?: string; MsgContent?: { Text?: string } }>;
}

/** 腾讯云IM 回调约定响应：FAIL + 非零 ErrorCode 即拦截发送 */
export interface ImCallbackResp {
  ActionStatus: 'OK' | 'FAIL';
  ErrorCode: number;
  ErrorInfo: string;
}

// 解锁前明文联系方式拦截（§5.6 防爬；红线 I3 服务端裁决）
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const WECHAT_RE = /(?:微信|weixin|wechat|wx|vx)\s*[:：号]?\s*[A-Za-z][A-Za-z0-9_-]{5,19}/i;

/**
 * 聊天室与接触升级（PRD §5.6，ARCHITECTURE §3.4）。SS 模式：发消息权限只在本回调按
 * unlock_record（active 且未过期）裁决——未解锁/过期一律 FAIL；含敏感词/解锁前明文联系方式拦截。
 * 图片鉴黄/OCR 兜底策略记录于 im_config.imageGuardStrategy（真实实现接天御 msgAudit）。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
    private readonly unlock: UnlockService,
    @Inject(CONFIG_CENTER) private readonly config: ConfigCenter,
    @Inject(IM) private readonly im: ImProvider,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(WECHAT_AUTH) private readonly wechat: WechatAuth,
  ) {}

  // ==================== 会话列表 / UserSig ====================

  async listConversations(userId: bigint, page: number, size: number) {
    const where = { OR: [{ userA: userId }, { userB: userId }] };
    const [total, convs] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({ where, orderBy: [{ lastMsgAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
    ]);
    const items = await Promise.all(
      convs.map(async (conv) => {
        const other = conv.userA === userId ? conv.userB : conv.userA;
        const [state, unreadCount] = await Promise.all([
          this.unlock.unlockStateBetween(userId, other),
          this.prisma.message.count({ where: { convId: conv.id, senderUserId: other, readFlag: false } }), // Step 12 角标
        ]);
        return { ...(await this.unlock.conversationView(conv, userId, state.active?.expireAt ?? state.lastExpireAt ?? new Date(0))), unreadCount };
      }),
    );
    // TabBar 角标 = 未读会话数之和（Step 12 Verify）：按全部会话汇总，不受分页影响
    const allConvs = await this.prisma.conversation.findMany({ where, select: { id: true, userA: true, userB: true } });
    const totalUnread = allConvs.length
      ? await this.prisma.message.count({
          where: { convId: { in: allConvs.map((c) => c.id) }, readFlag: false, senderUserId: { not: userId } },
        })
      : 0;
    return { total, totalUnread, page, size, items };
  }

  /** 进入会话即清未读（契约 POST /conversations/{id}/read） */
  async markConversationRead(userId: bigint, convId: bigint) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: convId, OR: [{ userA: userId }, { userB: userId }] } });
    if (!conv) throw new NotFoundException('会话不存在');
    await this.prisma.message.updateMany({ where: { convId: conv.id, readFlag: false, senderUserId: { not: userId } }, data: { readFlag: true } });
    return { unreadCount: 0 };
  }

  async getUserSig(userId: bigint) {
    const cfg = await this.config.get<ImCfg>(ConfigKeys.IM_CONFIG);
    return { sdkAppId: cfg.sdkAppId, userSig: await this.im.userSig(userId.toString()) };
  }

  // ==================== IM 云端回调（鉴权+风控+镜像） ====================

  async handleCallback(body: ImCallbackBody): Promise<ImCallbackResp> {
    if (body.CallbackCommand !== 'BeforeSendMsg') return { ActionStatus: 'OK', ErrorCode: 0, ErrorInfo: '' };

    let from: bigint;
    let to: bigint;
    try {
      from = BigInt(body.From_Account ?? '');
      to = BigInt(body.To_Account ?? '');
    } catch {
      return { ActionStatus: 'OK', ErrorCode: 0, ErrorInfo: '' }; // 非本系统账号：不拦截
    }
    if (from === to) return this.fail(20004, '不能给自己发消息');

    const [copy, cfg] = await Promise.all([
      this.config.get<ImCopy>(ConfigKeys.COPYWRITING),
      this.config.get<ImCfg>(ConfigKeys.IM_CONFIG),
    ]);
    const text = (body.MsgBody ?? [])
      .filter((m) => m.MsgType === 'TIMTextElem')
      .map((m) => m.MsgContent?.Text ?? '')
      .join('\n');
    const hasImage = (body.MsgBody ?? []).some((m) => m.MsgType === 'TIMImageElem');
    const conv = await this.findConversation(from, to);

    // ① 权限：仅 active 且未过期解锁可发（用例 2 延伸双向；过期/未解锁服务端拒绝，前端隐藏不算数）
    const active = conv ? await this.unlock.activeUnlockBetween(from, to) : null;
    if (!active) {
      if (PHONE_RE.test(text) || WECHAT_RE.test(text)) return this.fail(20001, copy.chatBlockedContactTip);
      return this.fail(20002, conv ? copy.chatExpiredSendTip : copy.chatNotUnlockedTip);
    }

    // ② 敏感词（msgAudit 简化版；真实实现叠加腾讯天御鉴黄）
    if (cfg.sensitiveWords.some((w) => text.includes(w))) return this.fail(20003, copy.chatSensitiveTip);

    // ③ 图片：策略 im_config.imageGuardStrategy（msg_audit + OCR 兜底，真实实现逐消息调用）
    const now = new Date();
    const digest = text ? text.slice(0, 30) : '[图片]';
    await this.prisma.$transaction([
      this.prisma.message.create({
        data: { convId: conv!.id, senderUserId: from, type: hasImage && !text ? MessageType.IMAGE : MessageType.TEXT, content: text || '[图片]' },
      }),
      this.prisma.conversation.update({ where: { id: conv!.id }, data: { lastMsgAt: now, lastMsgDigest: digest } }),
    ]);
    void this.notifyOffline(to, from, digest, cfg); // 离线补达（§性能：到达率走订阅消息）
    return { ActionStatus: 'OK', ErrorCode: 0, ErrorInfo: '' };
  }

  // ==================== 接触升级三动作（§5.6，D7 留痕） ====================

  async contactAction(userId: bigint, targetProfileId: bigint, action: ContactAction, photoIndex?: number) {
    const target = await this.profile.getUnlockTarget(targetProfileId);
    if (target.ownerUserId === userId) throw new BadRequestException('不能对自己操作');
    const conv = await this.findConversation(userId, target.ownerUserId);
    if (!conv) throw new NotFoundException('会话不存在，请先解锁对方');

    const [copy, state] = await Promise.all([
      this.config.get<ImCopy>(ConfigKeys.COPYWRITING),
      this.unlock.unlockStateBetween(userId, target.ownerUserId),
    ]);
    if (!state.active) {
      throw new BusinessException(
        403,
        'UNLOCK_REQUIRED',
        state.lastExpireAt && state.lastExpireAt.getTime() <= Date.now() ? copy.chatExpiredSendTip : copy.chatNotUnlockedTip,
      );
    }

    let photoUrl: string | null = null;
    if (action === ContactAction.SEND_PHOTO) {
      const mine = await this.profile.getActiveProfileRaw(userId);
      if (!mine) throw new BadRequestException('请先创建并生效你的档案');
      const key = this.photoKeyAt(mine.photos, photoIndex ?? 0);
      if (!key) throw new BadRequestException('档案没有可发送的照片');
      photoUrl = await this.storage.signedUrl(key, 600); // 解锁后清晰原图（限时签名，I3）
    }

    const [log] = await Promise.all([
      this.prisma.contactActionLog.create({ data: { convId: conv.id, actorUserId: userId, action } }),
      this.prisma.$transaction([
        this.prisma.message.create({
          data: { convId: conv.id, senderUserId: userId, type: MessageType.CONTACT_CARD, content: JSON.stringify({ kind: 'contact_card', action, ...(photoUrl ? { photoUrl } : {}) }) },
        }),
        this.prisma.conversation.update({ where: { id: conv.id }, data: { lastMsgAt: new Date(), lastMsgDigest: '[联系方式卡片]' } }),
      ]),
    ]);
    void this.im.sendSystemMsg(String(target.ownerUserId), `contact_card:${action}`).catch((e: Error) => this.logger.warn(`IM 系统消息失败: ${e.message}`));
    return {
      action,
      loggedAt: log.createdAt.toISOString(),
      cardSent: true,
      phone: action === ContactAction.CALL_PHONE ? target.owner.phone : null, // 服务端裁决下发（红线 I3）
      photoUrl,
    };
  }

  /** 解锁记录（退款判定 D7 查询入口：convId+action 索引） */
  async contactActionLogs(userId: bigint, convId: bigint) {
    const conv = await this.prisma.conversation.findFirstOrThrow({
      where: { id: convId, OR: [{ userA: userId }, { userB: userId }] },
    });
    const logs = await this.prisma.contactActionLog.findMany({ where: { convId: conv.id }, orderBy: { createdAt: 'desc' } });
    return { items: logs.map((l) => ({ action: l.action, actorUserId: l.actorUserId.toString(), loggedAt: l.createdAt.toISOString() })) };
  }

  // ==================== 私有 ====================

  private async findConversation(a: bigint, b: bigint) {
    const [userA, userB] = a < b ? [a, b] : [b, a];
    return this.prisma.conversation.findUnique({ where: { userA_userB: { userA, userB } } });
  }

  private async notifyOffline(recipientId: bigint, senderId: bigint, digest: string, cfg: ImCfg) {
    try {
      const pref = await this.prisma.notifyPref.findUnique({ where: { userId: recipientId } });
      if (!pref || pref.subscribeAuthStatus !== 'GRANTED') return;
      if ((pref.switches as Record<string, unknown>)?.im === false) return; // notify_pref 控制（ARCHITECTURE 3.4）
      const [recipient, sender] = await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: recipientId }, select: { openid: true } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { nickname: true } }),
      ]);
      await this.wechat.sendSubscribeMsg(recipient.openid, cfg.subscribeTemplates.newMessage, { nickname: sender.nickname, digest }, 'pages/message/index');
    } catch (e) {
      this.logger.warn(`订阅消息补达失败: ${(e as Error).message}`);
    }
  }

  private photoKeyAt(photos: Prisma.JsonValue, index: number): string | null {
    if (!Array.isArray(photos)) return null;
    const sorted = [...photos].sort((x, y) => Number((x as { sort?: number }).sort ?? 0) - Number((y as { sort?: number }).sort ?? 0));
    return (sorted[index] as { objectKey?: string })?.objectKey ?? null;
  }

  private fail(code: number, info: string): ImCallbackResp {
    return { ActionStatus: 'FAIL', ErrorCode: code, ErrorInfo: info };
  }
}
