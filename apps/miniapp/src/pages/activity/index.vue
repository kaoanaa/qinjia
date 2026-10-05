<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 精彩活动（PRD §5.1/§5.11）：运营位内容全部读 ops_slot 配置（红线 I1），未登录可见
interface Slot {
  id: string;
  type: string;
  content: { title?: string; text?: string; image?: string; linkPage?: string };
  startAt: string;
  endAt: string;
}
const slots = ref<Slot[]>([]);
const loaded = ref(false);

onShow(async () => {
  const res = await http.get<Slot[]>('/ops/slots?type=BANNER', { toast: false }).catch(() => null);
  slots.value = res ?? [];
  loaded.value = true;
});

function tap(s: Slot) {
  if (s.content.linkPage) uni.navigateTo({ url: `/${s.content.linkPage}` });
}
</script>

<template>
  <view class="page">
    <text class="title">精彩活动</text>

    <view v-for="s in slots" :key="s.id" class="slot" @click="tap(s)">
      <image v-if="s.content.image" :src="s.content.image" class="img" mode="widthFix" />
      <text class="st">{{ s.content.title || s.content.text }}</text>
      <text class="time">活动期：{{ s.startAt.slice(0, 10) }} 至 {{ s.endAt.slice(0, 10) }}</text>
    </view>

    <text v-if="loaded && !slots.length" class="empty">暂无活动，敬请期待</text>

    <!-- P2 占位入口（D8/Step 18）：直播浮窗、本地群 -->
    <view class="entry" @click="uni.navigateTo({ url: '/pages/live/index' })">
      <text class="entry-title">直播相亲</text>
      <text class="entry-tag">敬请期待</text>
    </view>
    <view class="entry" @click="uni.navigateTo({ url: '/pages/group/index' })">
      <text class="entry-title">同城家长群</text>
      <text class="entry-tag">敬请期待</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.slot { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.img { width: 100%; border-radius: 12rpx; }
.st { display: block; font-size: 36rpx; font-weight: bold; color: #222; }
.time { display: block; margin-top: 10rpx; font-size: 26rpx; color: #999; }
.empty { display: block; margin-top: 60rpx; text-align: center; font-size: 32rpx; color: #888; }
.entry { display: flex; justify-content: space-between; align-items: center; margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 16rpx; }
.entry-title { font-size: 36rpx; color: #222; }
.entry-tag { font-size: 28rpx; color: #e64340; }
</style>
