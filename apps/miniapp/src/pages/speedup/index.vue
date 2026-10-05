<script setup lang="ts">
// 加速脱单 = 1v1 管家轻量版（PRD D6/§5.12）：服务说明页；留资子页按用户要求暂缓
function goLead() {
  uni.navigateTo({ url: '/pages/speedup/lead/index' });
}
</script>

<template>
  <view class="page">
    <text class="title">加速脱单</text>
    <text class="sub">专属管家 1v1 牵线，帮您更快找到合适亲家</text>

    <view class="steps">
      <view class="step">
        <text class="idx">1</text>
        <view class="txt">
          <text class="name">登记需求</text>
          <text class="desc">留下您的城市、期望条件和预算，3 分钟填完</text>
        </view>
      </view>
      <view class="step">
        <text class="idx">2</text>
        <view class="txt">
          <text class="name">管家接单</text>
          <text class="desc">专属管家通过站内消息与您 1v1 沟通，为您把关</text>
        </view>
      </view>
      <view class="step">
        <text class="idx">3</text>
        <view class="txt">
          <text class="name">线下介绍</text>
          <text class="desc">管家人工牵线介绍，服务与计价线下沟通，明码标价</text>
        </view>
      </view>
    </view>

    <view class="tip-box">
      <text class="tip">管家不会向您索要密码、验证码，也不会让子女直接付费，请谨防假冒</text>
    </view>

    <button class="big-btn" @click="goLead">我要登记需求</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.steps { margin-top: 40rpx; }
.step { display: flex; align-items: flex-start; margin-bottom: 40rpx; }
.idx { width: 72rpx; height: 72rpx; line-height: 72rpx; text-align: center; border-radius: 50%; background: #e64340; color: #fff; font-size: 36rpx; font-weight: bold; flex: none; }
.txt { flex: 1; margin-left: 24rpx; }
.name { display: block; font-size: 36rpx; font-weight: bold; color: #222; }
.desc { display: block; margin-top: 8rpx; font-size: 30rpx; color: #666; line-height: 1.6; }
.tip-box { margin-top: 24rpx; padding: 24rpx; background: #fff8f0; border-radius: 16rpx; }
.tip { font-size: 28rpx; color: #e65100; line-height: 1.6; }
.big-btn { margin-top: 56rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
