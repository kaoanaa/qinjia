<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http, type ApiError } from '@/api/http';

// 开通会员（PRD §5.9/§5.10）：套餐读 paid_member_plan 配置；大额单 confirmRequired 二次确认
interface Plan {
  planId: string;
  name: string;
  days: number;
  quota: number;
  amountCent: number;
  originalAmountCent: number | null;
}
interface MemberCard {
  level: string;
  expireAt: string | null;
  quota: { totalRemaining: number };
  privileges: Array<{ key: string; label: string; enabled: boolean }>;
}
interface PrepayOrder {
  orderId: string;
  outTradeNo: string;
  amountCent: number;
  confirmRequired: boolean;
}

const plans = ref<Plan[]>([]);
const card = ref<MemberCard | null>(null);
const order = ref<PrepayOrder | null>(null);
const busy = ref(false);

const yuan = (cent: number) => (cent / 100).toFixed(2);

async function load() {
  plans.value = await http.get<Plan[]>('/member/plans');
  try {
    card.value = await http.get<MemberCard>('/member/me');
  } catch {
    /* 未登录时由 http 层跳登录 */
  }
}
onShow(load);

async function buy(p: Plan) {
  busy.value = true;
  try {
    const res = await http.post<PrepayOrder>('/orders', { type: 'MEMBER', planId: p.planId });
    if (res.confirmRequired) {
      const ok = await new Promise<boolean>((resolve) =>
        uni.showModal({
          title: '大额消费确认',
          content: `本次开通「${p.name}」需支付 ¥${yuan(res.amountCent)}，确认购买吗？`,
          confirmText: '确认购买',
          success: (r) => resolve(!!r.confirm),
        }),
      );
      if (!ok) return;
    }
    order.value = res;
  } catch {
    /* toast 已统一处理 */
  } finally {
    busy.value = false;
  }
}

/** demo 支付（真实小程序为 wx.requestPayment(res.paySignParams)） */
async function demoPay() {
  if (!order.value) return;
  busy.value = true;
  try {
    await http.post('/orders/callback/wxpay', {
      outTradeNo: order.value.outTradeNo,
      transactionId: `MOCK_TX_${Date.now()}`,
    });
    uni.showToast({ title: '开通成功', icon: 'none' });
    order.value = null;
    await load();
  } catch (e) {
    uni.showToast({ title: (e as ApiError).message || '支付失败', icon: 'none' });
  } finally {
    busy.value = false;
  }
}

const levelText: Record<string, string> = { NONE: '普通用户', TRIAL: '体验会员', PAID: '付费会员', INTENTION: '诚意会员' };
</script>

<template>
  <view class="page">
    <text class="title">开通会员</text>

    <view v-if="card" class="card me-card">
      <text class="me-level">{{ levelText[card.level] || card.level }}</text>
      <text class="me-sub">{{ card.expireAt ? `有效期至 ${card.expireAt.slice(0, 10)}` : '尚未开通会员' }}</text>
      <text class="me-sub">剩余解锁次数：{{ card.quota.totalRemaining }}</text>
      <view class="privs">
        <text v-for="pr in card.privileges" :key="pr.key" class="priv" :class="{ off: !pr.enabled }">{{ pr.label }}</text>
      </view>
    </view>

    <view v-for="p in plans" :key="p.planId" class="card plan">
      <view class="plan-head">
        <text class="plan-name">{{ p.name }}</text>
        <text class="plan-price">¥{{ yuan(p.amountCent) }}</text>
      </view>
      <text class="plan-sub">{{ p.days }} 天 · 每月 {{ p.quota }} 次解锁</text>
      <button class="buy-btn" :loading="busy" @click="buy(p)">开通</button>
    </view>

    <view v-if="order" class="card pay-card">
      <text class="pay-amt">待支付：¥{{ yuan(order.amountCent) }}</text>
      <text class="pay-sub">订单号 {{ order.orderId }}</text>
      <button class="buy-btn" :loading="busy" @click="demoPay">模拟微信支付（演示）</button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.card { margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 20rpx; }
.me-card { text-align: center; }
.me-level { display: block; font-size: 40rpx; font-weight: bold; color: #ff9800; }
.me-sub { display: block; margin-top: 12rpx; font-size: 30rpx; color: #555; }
.privs { display: flex; justify-content: center; margin-top: 20rpx; }
.priv { margin: 0 8rpx; padding: 8rpx 20rpx; font-size: 26rpx; color: #4caf50; background: #e8f5e9; border-radius: 24rpx; }
.priv.off { color: #aaa; background: #f2f2f2; }
.plan-head { display: flex; justify-content: space-between; align-items: center; }
.plan-name { font-size: 40rpx; font-weight: bold; color: #222; }
.plan-price { font-size: 44rpx; font-weight: bold; color: #e64340; }
.plan-sub { display: block; margin-top: 12rpx; font-size: 30rpx; color: #777; }
.buy-btn { margin-top: 24rpx; height: 92rpx; line-height: 92rpx; background: #e64340; color: #fff; font-size: 36rpx; border-radius: 46rpx; }
.pay-card { text-align: center; }
.pay-amt { font-size: 44rpx; font-weight: bold; color: #e64340; }
.pay-sub { display: block; margin-top: 12rpx; font-size: 28rpx; color: #999; }
</style>
