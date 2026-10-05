<script setup lang="ts">
import { ref } from 'vue';
import { http } from '@/api/http';

// 注销账号（PRD §5.8，PIPL）：风险提示 + 二次确认 + 短信验证（mock 固定码 123456）+ 冷静期
const checked = ref(false);
const smsCode = ref('');
const submitting = ref(false);

async function submit() {
  if (!checked.value) {
    uni.showToast({ title: '请先阅读并确认注销风险', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    const res = await http.post<{ effectiveAt: string }>('/settings/account-close', { confirmed: true, smsCode: smsCode.value.trim() });
    uni.showModal({
      title: '注销已受理',
      content: `您的账号将于 ${res.effectiveAt.slice(0, 10)}（冷静期结束）后正式注销并删除个人信息。在此期间重新登录可撤销注销申请。`,
      showCancel: false,
      success: () => {
        uni.removeStorageSync('qj_token');
        uni.reLaunch({ url: '/pages/auth/login/index' });
      },
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <text class="title">注销账号</text>

    <view class="warn">
      <text class="w-title">注销后：</text>
      <text class="w-item">· 您的档案、解锁记录、会话将全部删除或匿名化，无法恢复</text>
      <text class="w-item">· 剩余会员时长与解锁次数作废，不予退款（已付未退款项将按规则处理）</text>
      <text class="w-item">· 冷静期内重新登录可撤销本次注销</text>
    </view>

    <view class="row">
      <checkbox :checked="checked" color="#e64340" @click="checked = !checked" />
      <text class="agree" @click="checked = !checked">我已阅读并了解上述风险，确认注销账号</text>
    </view>

    <view class="row">
      <text class="label">短信验证码</text>
      <input v-model="smsCode" class="input" type="number" placeholder="发送到绑定手机的验证码" maxlength="6" />
    </view>

    <button class="big-btn danger" :loading="submitting" @click="submit">确认注销</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.warn { margin-top: 24rpx; padding: 28rpx; background: #fff3f3; border-radius: 16rpx; }
.w-title { display: block; font-size: 32rpx; color: #c62828; font-weight: bold; }
.w-item { display: block; margin-top: 12rpx; font-size: 28rpx; color: #7a2c2c; line-height: 1.6; }
.row { display: flex; align-items: center; margin-top: 32rpx; }
.agree { font-size: 32rpx; color: #333; margin-left: 8rpx; }
.label { width: 200rpx; font-size: 34rpx; color: #333; }
.input { flex: 1; height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; }
.big-btn { margin-top: 56rpx; height: 104rpx; line-height: 104rpx; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.big-btn.danger { background: #9e9e9e; }
</style>
