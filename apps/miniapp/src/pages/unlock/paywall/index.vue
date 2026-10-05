<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http, idemKey, type ApiError } from '@/api/http';

// 解锁付费墙（PRD §6.1/§6.3）：check 只读 → unlock（额度或 202 转订单）→ 支付回调后重试
interface CheckView {
  state: 'already_unlocked' | 'quota_available' | 'need_payment' | 'realname_required';
  targetMaritalVerified: boolean;
  riskConfirmRequired: boolean;
  oncePriceCent: number;
  expireAt: string | null;
}
interface UnlockView {
  unlockId: string;
  payType: string;
  quotaRemainAfter: number | null;
  expireAt: string;
  contact: { wechat: string | null; phone: string | null };
}
interface PrepayOrder {
  orderId: string;
  outTradeNo: string;
  amountCent: number;
  confirmRequired: boolean;
}

const profileId = ref('');
const matchNo = ref('');
const check = ref<CheckView | null>(null);
const order = ref<PrepayOrder | null>(null);
const done = ref<UnlockView | null>(null);
const busy = ref(false);

const stateText: Record<CheckView['state'], string> = {
  already_unlocked: '您已解锁过对方，可直接查看联系方式',
  quota_available: '有可用免费/会员解锁次数，扣 1 次即可解锁',
  need_payment: '暂无可用解锁次数，可单次付费解锁',
  realname_required: '完成实名认证后才能解锁（保护双方安全）',
};

async function loadCheck() {
  check.value = await http.post<CheckView>('/unlock/check', { profileId: profileId.value });
}

onLoad(async (q) => {
  profileId.value = (q as { profileId?: string })?.profileId ?? '';
  matchNo.value = (q as { matchNo?: string })?.matchNo ?? '';
  await loadCheck();
  if (check.value?.state === 'already_unlocked') await doUnlock(false);
});

/** 解锁：412 风险确认（服务端配置话术）→ 弹窗二次确认后重试；402 引导实名 */
async function doUnlock(riskConfirmed: boolean) {
  busy.value = true;
  try {
    const res = await http.post<UnlockView | { state: 'need_payment'; order: PrepayOrder }>(
      '/unlock',
      { profileId: profileId.value, riskConfirmed },
      { toast: false, headers: { 'Idempotency-Key': idemKey('unlock') } },
    );
    if ('unlockId' in res) {
      done.value = res;
      order.value = null;
    } else {
      order.value = res.order;
      uni.showToast({ title: '请完成支付', icon: 'none' });
    }
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 412 && err.errorCode === 'RISK_CONFIRM_REQUIRED') {
      uni.showModal({
        title: '风险提示',
        content: err.message,
        confirmText: '仍要解锁',
        cancelText: '再想想',
        success: (r) => r.confirm && void doUnlock(true),
      });
    } else if (err.code === 402 && err.errorCode === 'REALNAME_REQUIRED') {
      uni.showModal({
        title: '需要实名认证',
        content: err.message,
        confirmText: '去认证',
        success: (r) => r.confirm && uni.navigateTo({ url: '/pages/cert/realname/index' }),
      });
    } else {
      uni.showToast({ title: err.message || '解锁失败', icon: 'none' });
    }
  } finally {
    busy.value = false;
  }
}

/** demo 支付：直传 mock 回调报文（真实环境由微信服务器回调，小程序侧调起 wx.requestPayment） */
async function demoPay() {
  if (!order.value) return;
  busy.value = true;
  try {
    await http.post('/orders/callback/wxpay', {
      outTradeNo: order.value.outTradeNo,
      transactionId: `MOCK_TX_${Date.now()}`,
    });
    uni.showToast({ title: '支付成功，正在解锁', icon: 'none' });
    // 能产生订单说明风险确认已通过（412 先于扣费拦截），重放直接带 riskConfirmed
    await doUnlock(true);
  } catch (e) {
    uni.showToast({ title: (e as ApiError).message || '支付失败', icon: 'none' });
  } finally {
    busy.value = false;
  }
}

const yuan = (cent: number) => (cent / 100).toFixed(2);
</script>

<template>
  <view class="page">
    <text class="title">解锁对方{{ matchNo ? `（${matchNo}）` : '' }}</text>

    <view v-if="done" class="card ok-card">
      <text class="ok-big">解锁成功</text>
      <view class="contact">
        <text class="k">手机号</text><text class="v">{{ done.contact.phone || '对方未填写' }}</text>
      </view>
      <view class="contact">
        <text class="k">微信号</text><text class="v">{{ done.contact.wechat || '聊天中交换微信后可见' }}</text>
      </view>
      <text class="expire">有效期至 {{ done.expireAt.slice(0, 10) }}，期内可双向畅聊</text>
      <text v-if="typeof done.quotaRemainAfter === 'number'" class="expire">剩余解锁次数：{{ done.quotaRemainAfter }}</text>
    </view>

    <template v-else-if="check">
      <view class="card">
        <text class="state">{{ stateText[check.state] }}</text>
        <text v-if="check.riskConfirmRequired" class="risk">对方未提供婚姻证明，解锁前会再次与您确认</text>
      </view>

      <button
        v-if="check.state === 'quota_available' || check.state === 'need_payment' || check.state === 'realname_required'"
        class="big-btn"
        :loading="busy"
        @click="doUnlock(false)"
      >
        {{ check.state === 'quota_available' ? '用 1 次解锁名额' : `支付 ¥${yuan(check.oncePriceCent)} 解锁` }}
      </button>

      <view v-if="order" class="card pay-card">
        <text class="pay-amt">待支付：¥{{ yuan(order.amountCent) }}</text>
        <text class="pay-sub">订单号 {{ order.orderId }}</text>
        <button class="big-btn" :loading="busy" @click="demoPay">模拟微信支付（演示）</button>
      </view>
    </template>

    <text v-else class="sub">加载中…</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 24rpx; font-size: 32rpx; color: #555; }
.card { margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 20rpx; }
.state { font-size: 36rpx; color: #222; line-height: 1.6; }
.risk { display: block; margin-top: 16rpx; font-size: 30rpx; color: #e65100; }
.big-btn { margin-top: 40rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.ok-card { text-align: center; }
.ok-big { display: block; font-size: 44rpx; font-weight: bold; color: #2e7d32; }
.contact { display: flex; margin-top: 28rpx; text-align: left; }
.k { width: 160rpx; font-size: 34rpx; color: #777; }
.v { flex: 1; font-size: 38rpx; color: #222; font-weight: bold; }
.expire { display: block; margin-top: 24rpx; font-size: 30rpx; color: #777; }
.pay-card { text-align: center; }
.pay-amt { font-size: 44rpx; font-weight: bold; color: #e64340; }
.pay-sub { display: block; margin-top: 12rpx; font-size: 28rpx; color: #999; }
</style>
