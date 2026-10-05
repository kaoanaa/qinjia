<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 子女授权（PRD §5.2，红线 I5：短信验证 + 声明勾选留痕 consent_record）
// 入口：档案预览页「子女授权待完成」提示；发布页内联流程等价
const profileId = ref('');
const status = ref<'LOADING' | 'PENDING' | 'DONE' | 'NOT_REQUIRED' | 'MISSING'>('LOADING');
const childPhone = ref('');
const smsCode = ref('');
const checked = ref(false);
const smsSent = ref(false);
const busy = ref(false);

onLoad(async (q) => {
  const id = (q as { profileId?: string })?.profileId;
  if (!id) {
    status.value = 'MISSING';
    return;
  }
  profileId.value = id;
  const p = await http.get<{ consentStatus: string }>(`/profiles/${id}`, { toast: false }).catch(() => null);
  if (!p) {
    status.value = 'MISSING';
    return;
  }
  status.value = p.consentStatus === 'DONE' ? 'DONE' : p.consentStatus === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'PENDING';
});

async function sendSms() {
  if (!/^1\d{10}$/.test(childPhone.value)) {
    uni.showToast({ title: '请输入子女 11 位手机号', icon: 'none' });
    return;
  }
  await http.post('/consent/send-sms', { profileId: profileId.value, childPhone: childPhone.value });
  smsSent.value = true;
  uni.showToast({ title: '验证码已发送（模拟码 123456）', icon: 'none', duration: 3000 });
}

async function submit() {
  if (!checked.value) {
    uni.showToast({ title: '请先勾选授权声明', icon: 'none' });
    return;
  }
  busy.value = true;
  try {
    await http.post('/consent/verify', {
      profileId: profileId.value, childPhone: childPhone.value, code: smsCode.value, statementAccepted: true, statementVersion: 'v1',
    });
    status.value = 'DONE';
    uni.showToast({ title: '授权完成', icon: 'none' });
  } finally {
    busy.value = false;
  }
}

const statementText = [
  '《子女知情同意与授权声明》',
  '子女已知晓：父母代为建立相亲档案，档案中的个人信息（不含身份证等敏感原件）将向平台其他注册家长展示，用于相亲沟通。',
  '子女同意上述信息的收集与展示，并可随时通过平台撤回授权。',
].join('\n');
</script>

<template>
  <view class="page">
    <template v-if="status === 'PENDING'">
      <text class="title">子女授权</text>
      <text class="sub">为了孩子的知情权，需要子女本人短信验证授权后才能发布档案</text>

      <view class="doc"><text class="doc-text">{{ statementText }}</text></view>

      <input v-model="childPhone" class="input" type="number" placeholder="子女手机号" maxlength="11" />
      <button class="mini-btn" @click="sendSms">{{ smsSent ? '重发验证码' : '发送验证码' }}</button>
      <input v-model="smsCode" class="input" type="number" placeholder="验证码（模拟 123456）" maxlength="6" />

      <view class="check-row" @click="checked = !checked">
        <text class="box" :class="{ on: checked }">{{ checked ? '✓' : '' }}</text>
        <text class="check-label">子女知晓并同意以上内容</text>
      </view>

      <button class="big-btn" :loading="busy" @click="submit">完成授权</button>
    </template>

    <view v-else-if="status === 'DONE'" class="done">
      <text class="done-big">子女授权已完成</text>
      <text class="done-sub">授权记录已留存，可随时在「设置-授权管理」中撤回</text>
    </view>

    <view v-else-if="status === 'NOT_REQUIRED'" class="done">
      <text class="done-big">无需授权</text>
      <text class="done-sub">本人档案不需要子女授权</text>
    </view>

    <view v-else-if="status === 'MISSING'" class="done">
      <text class="done-sub">未找到档案，请从档案预览页重新进入</text>
    </view>

    <view v-else class="done"><text class="done-sub">加载中…</text></view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.doc { margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 16rpx; }
.doc-text { font-size: 32rpx; color: #333; line-height: 1.8; white-space: pre-line; }
.input { margin-top: 24rpx; height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; }
.mini-btn { margin-top: 24rpx; height: 84rpx; line-height: 84rpx; background: #ff9800; color: #fff; font-size: 32rpx; border-radius: 42rpx; }
.check-row { display: flex; align-items: center; margin-top: 32rpx; }
.box { width: 48rpx; height: 48rpx; border: 3rpx solid #999; border-radius: 8rpx; text-align: center; line-height: 44rpx; font-size: 36rpx; color: #e64340; margin-right: 16rpx; }
.box.on { border-color: #e64340; background: #fff5f5; font-weight: bold; }
.check-label { font-size: 34rpx; color: #222; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.done { margin-top: 80rpx; text-align: center; }
.done-big { display: block; font-size: 48rpx; font-weight: bold; color: #4caf50; }
.done-sub { display: block; margin-top: 24rpx; font-size: 32rpx; color: #555; }
</style>
