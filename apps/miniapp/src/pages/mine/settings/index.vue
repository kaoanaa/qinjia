<script setup lang="ts">
// 设置首页（PRD §5.8）：账号与安全入口集合
function go(url: string) {
  uni.navigateTo({ url });
}
</script>

<template>
  <view class="page">
    <text class="title">设置</text>

    <view class="group">
      <text class="g-title">账号与安全</text>
      <view class="item" @click="go('/pages/settings/phone-rebind/index')"><text>换绑手机号</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/settings/realname-info/index')"><text>实名信息</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/settings/consents/index')"><text>子女授权管理</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/settings/privacy/index')"><text>隐私设置</text><text class="arrow">›</text></view>
    </view>

    <view class="group">
      <text class="g-title">消息与帮助</text>
      <view class="item" @click="go('/pages/settings/notify/index')"><text>通知设置</text><text class="arrow">›</text></view>
      <view class="item" @click="go('/pages/mine/feedback/index')"><text>意见反馈</text><text class="arrow">›</text></view>
    </view>

    <view class="group">
      <text class="g-title">其他</text>
      <view class="item danger" @click="go('/pages/settings/close-account/index')"><text>注销账号</text><text class="arrow">›</text></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.group { margin-top: 28rpx; background: #fff; border-radius: 20rpx; overflow: hidden; }
.g-title { display: block; padding: 24rpx 28rpx 8rpx; font-size: 30rpx; color: #999; }
.item { display: flex; justify-content: space-between; align-items: center; padding: 28rpx; border-bottom: 2rpx solid #f5f5f5; font-size: 34rpx; color: #222; }
.item:last-child { border-bottom: none; }
.item.danger text { color: #e64340; }
.arrow { color: #ccc; font-size: 36rpx; }
</style>
