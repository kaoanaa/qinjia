<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 直播相亲（PRD D8/P2）：占位不开发，话术由 /live/widget 下发（copywriting 配置，红线 I1）
const tip = ref('直播相亲正在筹备中');

onShow(async () => {
  const res = await http.get<{ available: boolean; tip: string }>('/live/widget', { toast: false }).catch(() => null);
  if (res?.tip) tip.value = res.tip;
});
</script>

<template>
  <view class="page">
    <text class="title">直播相亲</text>
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
