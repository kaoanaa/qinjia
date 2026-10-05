<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 会员特权（PRD §5.9）：权益清单读配置（memberCard.privileges，红线 I1）
interface Card {
  level: string;
  expireAt: string | null;
  quota: { totalRemaining: number; limitLabel: string };
  privileges: Array<{ key: string; label: string; enabled: boolean }>;
}
const card = ref<Card | null>(null);

const levelText: Record<string, string> = { PAID: '正式会员', TRIAL: '体验会员', NONE: '普通用户' };

onShow(async () => {
  card.value = await http.get<Card>('/member/me', { toast: false }).catch(() => null);
});

function goPurchase() {
  uni.navigateTo({ url: '/pages/member/purchase/index' });
}
</script>

<template>
  <view class="page">
    <text class="title">会员特权</text>

    <view v-if="card" class="head" :class="{ paid: card.level !== 'NONE' }">
      <text class="lv">{{ levelText[card.level] || card.level }}</text>
      <text v-if="card.expireAt" class="exp">有效期至 {{ card.expireAt.slice(0, 10) }}</text>
      <text v-else class="exp">尚未开通会员</text>
    </view>

    <view v-if="card" class="list">
      <view v-for="pv in card.privileges" :key="pv.key" class="item">
        <text class="dot" :class="{ on: pv.enabled }">{{ pv.enabled ? '✓' : '—' }}</text>
        <text class="label" :class="{ off: !pv.enabled }">{{ pv.label }}</text>
      </view>
      <text v-if="!card.privileges.length" class="empty">权益清单加载中，请稍后再看</text>
    </view>
    <text v-else class="empty">请先登录</text>

    <button v-if="card && card.level === 'NONE'" class="big-btn" @click="goPurchase">开通会员，享全部特权</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.head { margin-top: 24rpx; padding: 32rpx; background: #f5f5f5; border-radius: 20rpx; }
.head.paid { background: linear-gradient(135deg, #3e2723, #6d4c41); }
.head.paid .lv, .head.paid .exp { color: #ffd54f; }
.lv { display: block; font-size: 40rpx; font-weight: bold; color: #222; }
.exp { display: block; margin-top: 8rpx; font-size: 28rpx; color: #666; }
.list { margin-top: 28rpx; background: #fff; border-radius: 20rpx; padding: 8rpx 28rpx; }
.item { display: flex; align-items: center; padding: 26rpx 0; border-bottom: 2rpx solid #f5f5f5; }
.item:last-child { border-bottom: none; }
.dot { width: 56rpx; font-size: 36rpx; color: #ccc; }
.dot.on { color: #4caf50; font-weight: bold; }
.label { flex: 1; font-size: 34rpx; color: #222; }
.label.off { color: #999; }
.empty { display: block; margin-top: 40rpx; text-align: center; font-size: 30rpx; color: #888; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
