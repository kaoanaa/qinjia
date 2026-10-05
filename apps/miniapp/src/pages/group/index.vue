<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 本地群（PRD D8/P2）：占位不开发，话术由 /local-groups 下发（copywriting 配置，红线 I1）
const tip = ref('同城家长群正在筹备中');

onShow(async () => {
  const res = await http.get<{ available: boolean; tip: string }>('/local-groups', { toast: false }).catch(() => null);
  if (res?.tip) tip.value = res.tip;
});
</script>

<template>
  <view class="page">
    <text class="title">同城家长群</text>
    <text class="big">敬请期待</text>
    <text class="sub">{{ tip }}</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; text-align: center; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.big { display: block; margin-top: 64rpx; font-size: 56rpx; font-weight: bold; color: #e64340; }
.sub { display: block; margin-top: 32rpx; font-size: 32rpx; color: #555; }
</style>
