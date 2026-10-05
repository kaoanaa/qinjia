<script setup lang="ts">
import { ref } from 'vue';
import { http, type ApiError } from '@/api/http';

// 单身承诺书（PRD §5.2，红线 I4：服务端强校验勾选）；发布失败按 errorCode 引导补齐实名/子女授权
const profileId = uni.getStorageSync('qj_profile_id') || '';
const relation = uni.getStorageSync('qj_relation') || 'MOTHER';
const checked = ref(false);
const submitting = ref(false);
const done = ref(false);

// 子女授权（relation≠SELF 且服务端提示 CONSENT_REQUIRED 时展开）
const needConsent = ref(false);
const childPhone = ref('');
const smsCode = ref('');
const consentChecked = ref(false);
const smsSent = ref(false);

const commitmentText = [
  '本人郑重承诺：',
  '1. 本档案所填写的信息真实、准确、完整；',
  '2. 档案当事人当前处于单身状态（未婚/离异/丧偶），无隐瞒婚姻史；',
  '3. 本人与档案中的异性无正在共同生活的伴侣关系；',
  '4. 如有虚假，愿承担相应责任并接受平台封禁处理。',
].join('\n');

async function publish() {
  if (!checked.value) {
    uni.showToast({ title: '请先勾选承诺书', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await http.post(`/profiles/${profileId}/publish`, { commitmentChecked: true, commitmentVersion: 'v1' }, { toast: false });
    done.value = true;
    uni.showToast({ title: '已提交，等待审核', icon: 'none' });
  } catch (e) {
    const err = e as ApiError;
    if (err.errorCode === 'REALNAME_REQUIRED') {
      uni.showModal({
        title: '需要实名认证',
        content: '发布前请先完成实名认证',
        confirmText: '去认证',
        success: (r) => r.confirm && uni.navigateTo({ url: '/pages/cert/realname/index' }),
      });
    } else if (err.errorCode === 'CONSENT_REQUIRED') {
      needConsent.value = true;
      uni.showToast({ title: '请完成子女短信授权', icon: 'none' });
    } else {
      uni.showToast({ title: err.message || '发布失败', icon: 'none' });
    }
  } finally {
    submitting.value = false;
  }
}

async function sendConsentSms() {
  if (!/^1\d{10}$/.test(childPhone.value)) {
    uni.showToast({ title: '请输入子女 11 位手机号', icon: 'none' });
    return;
  }
  await http.post('/consent/send-sms', { profileId, childPhone: childPhone.value });
  smsSent.value = true;
  uni.showToast({ title: '验证码已发送（模拟码 123456）', icon: 'none', duration: 3000 });
}

async function verifyConsent() {
  if (!consentChecked.value) {
    uni.showToast({ title: '请勾选授权声明', icon: 'none' });
    return;
  }
  await http.post('/consent/verify', {
    profileId, childPhone: childPhone.value, code: smsCode.value, statementAccepted: true, statementVersion: 'v1',
  });
  uni.showToast({ title: '授权完成，正在发布', icon: 'none' });
  await publish();
}
</script>

<template>
  <view class="page">
    <text class="title">单身承诺书</text>
    <view class="doc"><text class="doc-text">{{ commitmentText }}</text></view>

    <view class="check-row" @click="checked = !checked">
      <text class="box" :class="{ on: checked }">{{ checked ? '✓' : '' }}</text>
      <text class="check-label">我已阅读并承诺以上内容</text>
    </view>

    <view v-if="needConsent" class="consent">
      <text class="consent-title">子女授权（短信验证）</text>
      <input v-model="childPhone" class="input" type="number" placeholder="子女手机号" maxlength="11" />
      <button class="mini-btn" @click="sendConsentSms">{{ smsSent ? '重发验证码' : '发送验证码' }}</button>
      <input v-model="smsCode" class="input" type="number" placeholder="验证码（模拟 123456）" maxlength="6" />
      <view class="check-row" @click="consentChecked = !consentChecked">
        <text class="box" :class="{ on: consentChecked }">{{ consentChecked ? '✓' : '' }}</text>
        <text class="check-label">子女知晓并同意其信息用于相亲展示</text>
      </view>
      <button class="mini-btn green" @click="verifyConsent">完成授权并发布</button>
    </view>

    <button v-if="!done" class="big-btn" :loading="submitting" @click="publish">确认签署并发布档案</button>
    <view v-else class="done">
      <text class="done-big">提交成功</text>
      <text class="done-sub">档案已提交审核，通过后自动出现在推荐中{{ relation !== 'SELF' ? '（子女授权已留痕）' : '' }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.doc { margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 16rpx; }
.doc-text { font-size: 34rpx; color: #333; line-height: 1.8; white-space: pre-line; }
.check-row { display: flex; align-items: center; margin-top: 32rpx; }
.box { width: 48rpx; height: 48rpx; border: 3rpx solid #999; border-radius: 8rpx; text-align: center; line-height: 44rpx; font-size: 36rpx; color: #e64340; margin-right: 16rpx; }
.box.on { border-color: #e64340; background: #fff5f5; font-weight: bold; }
.check-label { font-size: 34rpx; color: #222; }
.consent { margin-top: 40rpx; padding: 32rpx; background: #fffbe9; border-radius: 16rpx; }
.consent-title { display: block; font-size: 36rpx; font-weight: bold; color: #333; margin-bottom: 16rpx; }
.input { margin-top: 16rpx; height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; }
.mini-btn { margin-top: 24rpx; height: 84rpx; line-height: 84rpx; background: #ff9800; color: #fff; font-size: 32rpx; border-radius: 42rpx; }
.mini-btn.green { background: #4caf50; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.done { margin-top: 48rpx; text-align: center; }
.done-big { display: block; font-size: 48rpx; font-weight: bold; color: #4caf50; }
.done-sub { display: block; margin-top: 24rpx; font-size: 32rpx; color: #555; }
</style>
