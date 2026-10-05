<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 邀请好友（PRD §5.15 拉新奖励）：GET /invite/info，奖励规则读配置（rewardRule.tip）
interface Info {
  inviteCode: string;
  rewardRule: { days: number; quota: number; tip: string };
  records: Array<{ inviteeMasked: string; rewardStatus: string; rewardedAt: string | null }>;
}

const info = ref<Info | null>(null);

onShow(async () => {
  info.value = await http.get<Info>('/invite/info', { toast: false }).catch(() => null);
});

function copyCode() {
  if (!info.value) return;
  uni.setClipboardData({ data: info.value.inviteCode });
}

const rewardText: Record<string, string> = { PENDING: '待发放', REWARDED: '已到账', INVALID: '未生效' };
</script>

<template>
  <view class="page">
    <text class="title">邀请好友</text>

    <view v-if="info" class="card">
      <text class="tip">{{ info.rewardRule.tip }}</text>
      <view class="code-row">
        <text class="code">{{ info.inviteCode }}</text>
        <text class="copy" @click="copyCode">复制</text>
      </view>
      <text class="sub">把邀请码告诉身边的家长，对方注册建档后您可获得 {{ info.rewardRule.quota }} 次解锁额度</text>
    </view>
    <text v-else class="empty">请先登录</text>

    <view v-if="info" class="group">
      <text class="g-title">邀请记录</text>
      <view v-for="(r, i) in info.records" :key="i" class="rec">
        <text class="who">{{ r.inviteeMasked }}</text>
        <text class="st">{{ rewardText[r.rewardStatus] || r.rewardStatus }}</text>
      </view>
      <text v-if="!info.records.length" class="no-rec">还没有邀请记录，快去分享邀请码吧</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.card { margin-top: 24rpx; padding: 32rpx; background: #fff; border-radius: 20rpx; }
.tip { display: block; font-size: 30rpx; color: #e65100; }
.code-row { display: flex; align-items: center; margin-top: 24rpx; }
.code { flex: 1; font-size: 52rpx; font-weight: bold; color: #e64340; letter-spacing: 6rpx; }
.copy { font-size: 30rpx; color: #fff; background: #1976f2; border-radius: 12rpx; padding: 12rpx 32rpx; }
.sub { display: block; margin-top: 20rpx; font-size: 28rpx; color: #666; line-height: 1.6; }
.group { margin-top: 28rpx; background: #fff; border-radius: 20rpx; padding: 8rpx 28rpx; }
.g-title { display: block; padding: 20rpx 0 8rpx; font-size: 30rpx; color: #999; }
.rec { display: flex; justify-content: space-between; padding: 24rpx 0; border-bottom: 2rpx solid #f5f5f5; font-size: 32rpx; color: #222; }
.rec:last-child { border-bottom: none; }
.st { color: #4caf50; font-size: 28rpx; }
.no-rec { display: block; padding: 32rpx 0; text-align: center; font-size: 30rpx; color: #888; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
