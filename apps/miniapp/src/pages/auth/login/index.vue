<script setup lang="ts">
import { ref } from 'vue';
import { http, setToken } from '@/api/http';

interface LoginResult {
  token: string;
  isNewUser: boolean;
  user: { id: string; nickname: string; phoneMasked: string | null };
}

const code = ref('DEMO_actor');
const loading = ref(false);
const me = ref<LoginResult['user'] | null>(null);
const phoneCode = ref('');

async function login() {
  loading.value = true;
  try {
    const res = await http.post<LoginResult>('/auth/login', { code: code.value.trim() });
    setToken(res.token);
    me.value = res.user;
    if (res.isNewUser) {
      uni.redirectTo({ url: '/pages/profile/relation/index' });
    } else {
      uni.switchTab({ url: '/pages/today/index' });
    }
  } catch {
    /* toast 已统一处理 */
  } finally {
    loading.value = false;
  }
}

/** mock：phoneNumber = 130 + phoneCode 补足 8 位 */
async function bindPhone() {
  await http.post('/auth/bind-phone', { phoneCode: phoneCode.value.trim() || '0001' });
  uni.showToast({ title: '手机号绑定成功', icon: 'none' });
}
</script>

<template>
  <view class="page">
    <text class="title">欢迎使用完美亲家</text>
    <text class="sub">家长帮孩子找对象，安全、真实、高效</text>

    <view class="field">
      <text class="label">模拟微信登录码</text>
      <input v-model="code" class="input" placeholder="DEMO_actor 为体验账号" />
    </view>

    <button class="big-btn" :loading="loading" @click="login">一键登录</button>
    <text class="tip">体验账号已备好资料与推荐，可直接浏览</text>

    <view v-if="me && !me.phoneMasked" class="field">
      <text class="label">绑定手机号（模拟 getPhoneNumber 码）</text>
      <input v-model="phoneCode" class="input" placeholder="如 0001" />
      <button class="mini-btn" @click="bindPhone">绑定</button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.field { margin-top: 48rpx; }
.label { display: block; font-size: 32rpx; color: #333; margin-bottom: 16rpx; }
.input { height: 96rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 36rpx; background: #fff; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.tip { display: block; margin-top: 24rpx; font-size: 28rpx; color: #888; text-align: center; }
.mini-btn { margin-top: 24rpx; height: 80rpx; line-height: 80rpx; background: #4caf50; color: #fff; font-size: 32rpx; border-radius: 40rpx; }
</style>
