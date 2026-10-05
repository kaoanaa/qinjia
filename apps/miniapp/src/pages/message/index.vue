<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 消息中心（PRD §5.12）：会话列表（TabBar 角标=totalUnread）+ 系统消息/有意向入口
interface Conv {
  id: string;
  counterpart: { userId: string; profileId: string; nickname: string; matchNo: string; childDigest: string; memberBadge: boolean };
  lastMsgAt: string | null;
  lastMsgDigest: string | null;
  unlockExpireAt: string;
  canSend: boolean;
  unreadCount: number;
}

const convs = ref<Conv[]>([]);
const totalUnread = ref(0);
const notifyUnread = ref(0);

async function load() {
  const res = await http.get<{ totalUnread: number; items: Conv[] }>('/conversations?size=50', { toast: false }).catch(() => null);
  if (res) {
    convs.value = res.items;
    totalUnread.value = res.totalUnread;
  }
  const notes = await http.get<{ unread: number }>('/notifications?size=1', { toast: false }).catch(() => null);
  if (notes) notifyUnread.value = notes.unread;
}
onShow(load);

function timeText(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

function openRoom(c: Conv) {
  uni.navigateTo({ url: `/pages/chat/room/index?convId=${c.id}` });
}
</script>

<template>
  <view class="page">
    <text class="title">消息</text>

    <view class="entries">
      <view class="entry" @click="uni.navigateTo({ url: '/pages/message/system/index' })">
        <text>系统消息</text>
        <text v-if="notifyUnread" class="dot">{{ notifyUnread }}</text>
      </view>
      <view class="entry" @click="uni.navigateTo({ url: '/pages/message/wall/index' })">
        <text>谁对我有意向</text>
      </view>
    </view>

    <view v-for="c in convs" :key="c.id" class="conv" @click="openRoom(c)">
      <view class="ava"><text>{{ c.counterpart.nickname.slice(0, 1) }}</text></view>
      <view class="mid">
        <view class="row1">
          <text class="name">{{ c.counterpart.nickname }}</text>
          <text class="time">{{ timeText(c.lastMsgAt) }}</text>
        </view>
        <text class="digest">{{ c.lastMsgDigest || `编号 ${c.counterpart.matchNo} · ${c.counterpart.childDigest}` }}</text>
      </view>
      <view class="right">
        <text v-if="c.unreadCount" class="badge">{{ c.unreadCount }}</text>
        <text v-if="!c.canSend" class="expired">已到期</text>
      </view>
    </view>

    <text v-if="!convs.length" class="empty">还没有会话，去「今日推荐」解锁心仪的亲家吧</text>
    <text class="foot">未读合计：{{ totalUnread }}</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.entries { display: flex; margin-top: 24rpx; }
.entry { position: relative; flex: 1; margin-right: 20rpx; padding: 28rpx; background: #fff; border-radius: 16rpx; font-size: 32rpx; color: #333; }
.dot { position: absolute; top: 12rpx; right: 12rpx; min-width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center; background: #e64340; color: #fff; border-radius: 20rpx; font-size: 24rpx; padding: 0 8rpx; }
.conv { display: flex; align-items: center; margin-top: 20rpx; padding: 24rpx; background: #fff; border-radius: 16rpx; }
.ava { width: 96rpx; height: 96rpx; border-radius: 48rpx; background: #ffe9e8; text-align: center; line-height: 96rpx; font-size: 40rpx; color: #e64340; }
.mid { flex: 1; margin-left: 20rpx; overflow: hidden; }
.row1 { display: flex; justify-content: space-between; }
.name { font-size: 36rpx; color: #222; font-weight: bold; }
.time { font-size: 26rpx; color: #999; }
.digest { display: block; margin-top: 8rpx; font-size: 30rpx; color: #666; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.right { margin-left: 16rpx; text-align: right; }
.badge { display: inline-block; min-width: 40rpx; height: 40rpx; line-height: 40rpx; text-align: center; background: #e64340; color: #fff; border-radius: 20rpx; font-size: 24rpx; padding: 0 8rpx; }
.expired { display: block; margin-top: 8rpx; font-size: 24rpx; color: #999; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
.foot { display: block; margin-top: 32rpx; text-align: center; font-size: 26rpx; color: #aaa; }
</style>
