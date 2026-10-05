<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 系统消息（PRD §5.12）：审核/到期/奖励到账，模板话术全部读配置
interface Notice {
  id: string;
  category: string;
  title: string;
  body: string;
  readFlag: boolean;
  createdAt: string;
}

const items = ref<Notice[]>([]);
const unread = ref(0);

const catText: Record<string, string> = {
  review: '审核', expire: '到期', reward: '奖励', greet: '打招呼', ticket: '工单', system: '通知',
};

async function load() {
  const res = await http.get<{ items: Notice[]; unread: number }>('/notifications?size=50');
  items.value = res.items;
  unread.value = res.unread;
}
onShow(load);

async function readAll() {
  await http.post('/notifications/read-all', {});
  await load();
}
</script>

<template>
  <view class="page">
    <view class="head">
      <text class="title">系统消息</text>
      <text v-if="unread" class="readall" @click="readAll">全部标已读（{{ unread }}）</text>
    </view>

    <view v-for="n in items" :key="n.id" class="item" :class="{ off: n.readFlag }">
      <view class="row1">
        <text class="cat">{{ catText[n.category] || '通知' }}</text>
        <text class="n-title">{{ n.title }}</text>
        <text v-if="!n.readFlag" class="ndot" />
      </view>
      <text class="n-body">{{ n.body }}</text>
      <text class="n-time">{{ n.createdAt.slice(0, 16).replace('T', ' ') }}</text>
    </view>

    <text v-if="!items.length" class="empty">暂无系统消息</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.head { display: flex; justify-content: space-between; align-items: center; }
.title { font-size: 44rpx; font-weight: bold; color: #222; }
.readall { font-size: 30rpx; color: #1976f2; }
.item { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 16rpx; }
.item.off { opacity: 0.6; }
.row1 { display: flex; align-items: center; }
.cat { font-size: 24rpx; color: #e64340; background: #fff0ef; border-radius: 8rpx; padding: 4rpx 12rpx; margin-right: 12rpx; }
.n-title { flex: 1; font-size: 36rpx; font-weight: bold; color: #222; }
.ndot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #e64340; }
.n-body { display: block; margin-top: 12rpx; font-size: 32rpx; color: #444; line-height: 1.6; }
.n-time { display: block; margin-top: 12rpx; font-size: 26rpx; color: #999; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
