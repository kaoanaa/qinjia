<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 换绑手机号（PRD §5.8）：微信手机号快速验证，复用 POST /auth/bind-phone（覆盖式绑定，服务端查重）
const phoneMasked = ref('');
const phoneCode = ref('');
const submitting = ref(false);

onShow(async () => {
  const me = await http.get<{ phoneMasked: string | null }>('/auth/me', { toast: false }).catch(() => null);
  phoneMasked.value = me?.phoneMasked || '未绑定';
});

async function submit() {
  if (!phoneCode.value.trim()) {
    uni.showToast({ title: '请填写手机号验证码', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await http.post('/auth/bind-phone', { phoneCode: phoneCode.value.trim() });
    uni.showToast({ title: '手机号已更新', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 800);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <text class="title">换绑手机号</text>
    <text class="sub">当前绑定：{{ phoneMasked }}</text>

    <view class="row">
      <text class="label">新手机号</text>
      <input v-model="phoneCode" class="input" placeholder="微信授权获取（mock 填 6 位数字）" maxlength="20" />
    </view>
    <text class="tip">换绑后，登录、解锁通知、客服联系都将使用新号码</text>

    <button class="big-btn" :loading="submitting" @click="submit">确认换绑</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.row { display: flex; align-items: center; margin-top: 40rpx; }
.label { width: 200rpx; font-size: 34rpx; color: #333; }
.input { flex: 1; height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; }
.tip { display: block; margin-top: 20rpx; font-size: 28rpx; color: #999; }
.big-btn { margin-top: 64rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
