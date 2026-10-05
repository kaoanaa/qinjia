<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 聊天室（PRD §5.6）：真实 IM SDK 在此仅作发送通道；权限/风控由服务端 /im/callback 裁决（红线 I3）
interface Conv {
  id: string;
  counterpart: { userId: string; profileId: string; nickname: string; matchNo: string; childDigest: string };
  unlockExpireAt: string;
  canSend: boolean;
}
interface Bubble {
  mine: boolean;
  text: string;
  sys?: boolean;
}

const conv = ref<Conv | null>(null);
const myId = ref('');
const input = ref('');
const bubbles = ref<Bubble[]>([]);
const sending = ref(false);

onLoad(async (q) => {
  const convId = (q as { convId?: string })?.convId ?? '';
  const me = await http.get<{ id: string }>('/auth/me');
  myId.value = me.id;
  const res = await http.get<{ items: Conv[] }>('/conversations?size=50');
  conv.value = res.items.find((c) => c.id === convId) ?? null;
  if (conv.value) {
    bubbles.value.push({ mine: false, sys: true, text: `已解锁会话，有效期至 ${conv.value.unlockExpireAt.slice(0, 10)}（消息镜像演示，真实环境走 IM SDK 拉取历史）` });
    await http.post(`/conversations/${convId}/read`, {}, { toast: false }).catch(() => undefined);
  }
});

/** 发送=走 IM 云端回调通道让服务端裁决：被拒时 ErrorInfo 即配置话术（chatBlockedContactTip 等） */
async function send() {
  const text = input.value.trim();
  if (!text || !conv.value) return;
  sending.value = true;
  try {
    const res = await http.post<{ ActionStatus: string; ErrorInfo?: string }>('/im/callback', {
      CallbackCommand: 'BeforeSendMsg',
      From_Account: myId.value,
      To_Account: conv.value.counterpart.userId,
      MsgBody: [{ MsgType: 'TIMTextElem', MsgContent: { Text: text } }],
    }, { toast: false });
    bubbles.value.push({ mine: true, text });
    if (res.ActionStatus !== 'OK') {
      bubbles.value.push({ mine: false, sys: true, text: `服务端拦截：${res.ErrorInfo || '消息未发送'}` });
    }
    input.value = '';
  } catch (e) {
    bubbles.value.push({ mine: false, sys: true, text: `发送失败：${(e as { message?: string }).message ?? ''}` });
  } finally {
    sending.value = false;
  }
}

async function action(kind: 'wechat' | 'phone' | 'photo') {
  if (!conv.value) return;
  const pid = conv.value.counterpart.profileId;
  if (kind === 'wechat') {
    await http.post(`/contact/${pid}/exchange-wechat`, {});
    bubbles.value.push({ mine: true, sys: true, text: '已发送「交换微信」卡片，对方同意后双方可见微信号' });
  } else if (kind === 'phone') {
    const r = await http.post<{ phone: string | null }>(`/contact/${pid}/call-phone`, {});
    bubbles.value.push({ mine: true, sys: true, text: `已拨打：${r.phone ?? '对方未留手机号'}（操作已留痕）` });
  } else {
    const r = await http.post<{ photoUrl: string | null }>(`/contact/${pid}/send-photo`, { photoIndex: 0 });
    bubbles.value.push({ mine: true, sys: true, text: r.photoUrl ? '已发送一张照片（解锁后原图）' : '发送照片失败' });
  }
}
</script>

<template>
  <view class="page">
    <view v-if="conv" class="head">
      <text class="head-name">{{ conv.counterpart.nickname }}（{{ conv.counterpart.matchNo }}）</text>
      <text class="head-sub">{{ conv.counterpart.childDigest }}</text>
    </view>

    <scroll-view v-if="conv" class="bubbles" scroll-y>
      <view v-for="(b, i) in bubbles" :key="i" class="b-row" :class="{ mine: b.mine }">
        <view class="b" :class="{ sys: b.sys }"><text>{{ b.text }}</text></view>
      </view>
    </scroll-view>

    <view v-if="conv" class="quick">
      <text class="qbtn" @click="action('wechat')">交换微信</text>
      <text class="qbtn" @click="action('phone')">拨打电话</text>
      <text class="qbtn" @click="action('photo')">发张照片</text>
    </view>

    <view v-if="conv" class="bar">
      <input v-model="input" class="bar-input" placeholder="发消息…试试发送微信号/敏感词看拦截" confirm-type="send" @confirm="send" />
      <button class="bar-send" :loading="sending" :disabled="!conv.canSend" @click="send">发送</button>
    </view>

    <view v-else class="empty"><text>会话不存在或已过期</text></view>
  </view>
</template>

<style lang="scss" scoped>
.page { display: flex; flex-direction: column; height: 100vh; padding: 24rpx 32rpx; box-sizing: border-box; }
.head { padding: 20rpx 0; border-bottom: 2rpx solid #eee; }
.head-name { font-size: 36rpx; font-weight: bold; color: #222; }
.head-sub { display: block; margin-top: 6rpx; font-size: 28rpx; color: #777; }
.bubbles { flex: 1; margin-top: 16rpx; }
.b-row { display: flex; margin-bottom: 20rpx; }
.b-row.mine { justify-content: flex-end; }
.b { max-width: 78%; padding: 20rpx 24rpx; border-radius: 16rpx; background: #fff; font-size: 34rpx; color: #222; }
.b-row.mine .b { background: #95ec69; }
.b.sys { align-self: center; background: #f2f2f2; color: #888; font-size: 26rpx; max-width: 90%; }
.quick { display: flex; margin: 16rpx 0; }
.qbtn { margin-right: 20rpx; padding: 14rpx 28rpx; background: #fff; border: 2rpx solid #e64340; color: #e64340; border-radius: 32rpx; font-size: 28rpx; }
.bar { display: flex; align-items: center; padding: 16rpx 0 24rpx; }
.bar-input { flex: 1; height: 88rpx; background: #fff; border-radius: 44rpx; padding: 0 28rpx; font-size: 34rpx; }
.bar-send { width: 160rpx; margin-left: 16rpx; height: 88rpx; line-height: 88rpx; background: #07c160; color: #fff; font-size: 32rpx; border-radius: 44rpx; }
.empty { margin-top: 120rpx; text-align: center; font-size: 34rpx; color: #888; }
</style>
