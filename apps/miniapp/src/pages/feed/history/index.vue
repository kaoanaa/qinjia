<script setup lang="ts">
import { ref } from 'vue';
import { onShow, onReachBottom } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 历史推荐（D4/用例 8）：被轮换出当日的档案可找回并解锁
const items = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);

async function load(next = 1) {
  const res = await http.get<{ total: number; items: Record<string, unknown>[] }>(`/feed/history?page=${next}&size=10`);
  items.value = next === 1 ? res.items : [...items.value, ...res.items];
  total.value = res.total;
  page.value = next;
}
onShow(() => load(1));
onReachBottom(() => {
  if (items.value.length < total.value) void load(page.value + 1);
});

function open(_profileId: string, matchNo: string) {
  uni.navigateTo({ url: `/pages/feed/detail/index?matchNo=${matchNo}` });
}
</script>

<template>
  <view class="page">
    <text class="title">历史推荐</text>
    <text class="sub">错过的缘分也能找回来，仍可查看和解锁</text>

    <qj-card v-for="c in items" :key="(c as { profileId: string }).profileId" :card="c as never" @tap="open" />
    <text v-if="!items.length" class="empty">暂无历史推荐</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
