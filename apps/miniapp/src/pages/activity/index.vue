<script setup lang="ts">
// 运营活动位：中心 Tab，内容由 ops_slot 后台配置（PRD §5.1/§5.11）
function go(url: string) {
  uni.navigateTo({ url });
}
</script>

<template>
  <view class="page">
    <text class="title">精彩活动</text>
    <text class="sub">运营位读取 ops_slot 配置（Step 13）</text>

    <!-- P2 占位入口（D8/Step 18）：直播浮窗、本地群 -->
    <view class="entry" @click="go('/pages/live/index')">
      <text class="entry-title">直播相亲</text>
      <text class="entry-tag">敬请期待</text>
    </view>
    <view class="entry" @click="go('/pages/group/index')">
      <text class="entry-title">同城家长群</text>
      <text class="entry-tag">敬请期待</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 24rpx; font-size: 32rpx; color: #555; }
.entry { display: flex; justify-content: space-between; align-items: center; margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 16rpx; }
.entry-title { font-size: 36rpx; color: #222; }
.entry-tag { font-size: 28rpx; color: #e64340; }
</style>
