<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 打招呼收件箱（PRD §5.7 P1）：数据源 /notifications 中 category=greet 的记录，
// 标题模板“{nickname}（编号{matchNo}）跟您打招呼了”（copywriting 配置下发）
interface Notice {
  id: string;
  category: string;
  title: string;
  body: string;
  readFlag: boolean;
  createdAt: string;
}
const all = ref<Notice[]>([]);

const items = computed(() => all.value.filter((n) => n.category === 'greet'));

onShow(async () => {
  const res = await http.get<{ items: Notice[] }>('/notifications?size=100', { toast: false }).catch(() => null);
  all.value = res?.items ?? [];
});

function openMatch(title: string) {
  const m = title.match(/编号([A-Za-z0-9_]+)/);
  if (m) uni.navigateTo({ url: `/pages/feed/detail/index?matchNo=${m[1]}` });
}

async function readAll() {
  await http.post('/notifications/read-all');
  all.value = all.value.map((n) => ({ ...n, readFlag: true }));
}
</script>

<template>
  <view class="page">
    <view class="head">
      <text class="title">打招呼消息</text>
      <text v-if="items.some(i => !i.readFlag)" class="read-all" @click="readAll">全部标已读</text>
    </view>

    <view v-for="g in items" :key="g.id" class="item" :class="{ unread: !g.readFlag }" @click="openMatch(g.title)">
      <view class="dot" :class="{ on: !g.readFlag }" />
      <view class="body">
        <text class="t">{{ g.title }}</text>
        <text class="b">{{ g.body }}</text>
        <text class="time">{{ g.createdAt.slice(0, 16).replace('T', ' ') }}</text>
      </view>
    </view>

    <text v-if="!items.length" class="empty">还没有人跟您打招呼，去今日推荐看看</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.head { display: flex; justify-content: space-between; align-items: center; }
.title { font-size: 44rpx; font-weight: bold; color: #222; }
.read-all { font-size: 30rpx; color: #1976f2; }
.item { display: flex; margin-top: 20rpx; padding: 28rpx; background: #fff; border-radius: 16rpx; }
.item.unread { background: #fff8f7; }
.dot { width: 16rpx; height: 16rpx; border-radius: 50%; background: #eee; margin: 14rpx 16rpx 0 0; }
.dot.on { background: #e64340; }
.body { flex: 1; }
.t { display: block; font-size: 34rpx; font-weight: bold; color: #222; }
.b { display: block; margin-top: 8rpx; font-size: 30rpx; color: #555; line-height: 1.5; }
.time { display: block; margin-top: 8rpx; font-size: 26rpx; color: #999; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
