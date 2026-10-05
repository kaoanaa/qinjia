<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 谁对我有意向（PRD §5.7）：三大墙；非会员模糊由服务端裁决，前端仅展示
type WallType = 'unlocked-me' | 'viewed-me' | 'favorited-me';

const tabs: Array<{ key: WallType; label: string }> = [
  { key: 'unlocked-me', label: '解锁我的' },
  { key: 'viewed-me', label: '看过我的' },
  { key: 'favorited-me', label: '收藏我的' },
];
const active = ref<WallType>('unlocked-me');
const items = ref<Record<string, unknown>[]>([]);
const isMemberVisible = ref(true);
const loading = ref(false);
const needProfile = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await http.get<{ isMemberVisible: boolean; items: Record<string, unknown>[] }>(`/walls/${active.value}`, { toast: false });
    items.value = res.items;
    isMemberVisible.value = res.isMemberVisible;
    needProfile.value = false;
  } catch {
    needProfile.value = true;
    items.value = [];
  } finally {
    loading.value = false;
  }
}
onShow(load);

function switchTab(k: WallType) {
  active.value = k;
  void load();
}

function open(_profileId: string, matchNo: string) {
  uni.navigateTo({ url: `/pages/feed/detail/index?matchNo=${matchNo}` });
}
</script>

<template>
  <view class="page">
    <text class="title">谁对我有意向</text>

    <view class="tabs">
      <text v-for="t in tabs" :key="t.key" class="tab" :class="{ on: active === t.key }" @click="switchTab(t.key)">{{ t.label }}</text>
    </view>

    <text v-if="needProfile" class="wall-tip">还没有生效档案，先建档发布后才能看到意向墙</text>
    <text v-else-if="!isMemberVisible" class="wall-tip">开通会员后可查看完整名单，当前已为您模糊处理</text>

    <qj-card v-for="c in items" :key="(c as { profileId: string }).profileId" :card="c as never" @tap="open" />
    <text v-if="!loading && !items.length && !needProfile" class="empty">这个墙暂时还没有人，先去今日推荐看看</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.tabs { display: flex; margin-top: 24rpx; }
.tab { flex: 1; text-align: center; padding: 20rpx 0; font-size: 32rpx; color: #555; background: #fff; border-radius: 12rpx; margin-right: 16rpx; }
.tab.on { color: #fff; background: #e64340; font-weight: bold; }
.wall-tip { display: block; margin-top: 20rpx; font-size: 28rpx; color: #e65100; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
