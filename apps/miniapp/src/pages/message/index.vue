<script setup lang="ts">
// 消息中心：亲家会话列表 + 系统消息（PRD §5.7，Step 12 实现）
import { MessageType } from '@qinjia/shared';

const demo = MessageType.CONTACT_CARD; // 验证 shared 引用
</script>

<template>
  <view class="page">
    <text class="title">消息</text>
    <text class="sub">会话列表建设中（Step 12）· {{ demo }}</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 24rpx; font-size: 32rpx; color: #555; }
</style>
