<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 我的优惠券（PRD §5.15）：GET /coupons/mine?status（响应为数组）
interface Coupon {
  id: string;
  name: string;
  scope: string;
  amountCent: number;
  minAmountCent: number;
  status: 'UNUSED' | 'USED' | 'EXPIRED';
  expireAt: string;
  expireInMs: number;
}

const tabs: Array<{ key: string; label: string }> = [
  { key: 'UNUSED', label: '可使用' },
  { key: 'USED', label: '已使用' },
  { key: 'EXPIRED', label: '已过期' },
];
const active = ref('UNUSED');
const items = ref<Coupon[]>([]);

const scopeText: Record<string, string> = { MEMBER: '会员订单', UNLOCK: '单次解锁', ALL: '全部订单' };

async function load() {
  items.value = await http.get<Coupon[]>(`/coupons/mine?status=${active.value}`).catch(() => []);
}
onShow(load);

function switchTab(k: string) {
  active.value = k;
  void load();
}

const yuan = (c: number) => (c / 100).toFixed(0);
</script>

<template>
  <view class="page">
    <text class="title">我的优惠券</text>

    <view class="tabs">
      <text v-for="t in tabs" :key="t.key" class="tab" :class="{ on: active === t.key }" @click="switchTab(t.key)">{{ t.label }}</text>
    </view>

    <view v-for="c in items" :key="c.id" class="cp" :class="{ off: c.status !== 'UNUSED' }">
      <view class="left">
        <text class="amt">¥{{ yuan(c.amountCent) }}</text>
        <text class="cond">满{{ yuan(c.minAmountCent) }}可用</text>
      </view>
      <view class="right">
        <text class="name">{{ c.name }}</text>
        <text class="scope">{{ scopeText[c.scope] || c.scope }}</text>
        <text class="exp">{{ c.status === 'UNUSED' ? `${c.expireAt.slice(0, 10)} 到期` : c.status === 'USED' ? '已使用' : '已过期' }}</text>
      </view>
    </view>

    <text v-if="!items.length" class="empty">暂无{{ tabs.find(t => t.key === active)?.label }}优惠券</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.tabs { display: flex; margin-top: 24rpx; }
.tab { flex: 1; text-align: center; padding: 20rpx 0; font-size: 32rpx; color: #555; background: #fff; border-radius: 12rpx; margin-right: 16rpx; }
.tab.on { color: #fff; background: #e64340; font-weight: bold; }
.cp { display: flex; margin-top: 24rpx; background: #fff; border-radius: 16rpx; overflow: hidden; }
.cp.off { opacity: 0.5; }
.left { width: 220rpx; background: #fff0ef; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32rpx 0; }
.amt { font-size: 52rpx; font-weight: bold; color: #e64340; }
.cond { margin-top: 8rpx; font-size: 26rpx; color: #e65100; }
.right { flex: 1; padding: 28rpx; }
.name { display: block; font-size: 36rpx; font-weight: bold; color: #222; }
.scope { display: block; margin-top: 8rpx; font-size: 30rpx; color: #555; }
.exp { display: block; margin-top: 8rpx; font-size: 26rpx; color: #999; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
