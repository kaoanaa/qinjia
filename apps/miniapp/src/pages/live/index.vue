<script setup lang="ts">
// 直播相亲（PRD D8/P2）：占位不开发，话术由 /api/v1/live/widget stub 下发（copywriting 配置）
</script>

<template>
  <view class="page">
    <text class="title">直播相亲</text>
    <text class="big">敬请期待</text>
    <text class="sub">直播红娘牵线正在筹备中，上线后会第一时间通知您</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; text-align: center; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.big { display: block; margin-top: 64rpx; font-size: 56rpx; font-weight: bold; color: #e64340; }
.sub { display: block; margin-top: 32rpx; font-size: 32rpx; color: #555; }
</style>
