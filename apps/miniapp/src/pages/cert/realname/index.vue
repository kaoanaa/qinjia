<script setup lang="ts">
import { ref } from 'vue';
import { http } from '@/api/http';

// 实名认证（PRD §5.2/§6.6）：直传凭证 → 身份证OCR → 人脸核身初始化 → 校验（外部服务全 mock，链路真实）
const steps = ['上传身份证照片', '识别身份信息', '发起人脸核验', '核验通过'];
const current = ref(-1);
const passed = ref(false);
const running = ref(false);
const masked = ref('');

async function go() {
  running.value = true;
  try {
    current.value = 0;
    const tok = await http.post<{ objectKey: string }>('/media/upload-token', { bucket: 'id_card', mime: 'image/jpeg' });
    current.value = 1;
    const ocr = await http.post<{ certId: string; name?: string; idCardNoMasked?: string }>('/cert/idcard-ocr', { objectKey: tok.objectKey });
    masked.value = [ocr.name, ocr.idCardNoMasked].filter(Boolean).join(' ') || `凭证号 ${ocr.certId}`;
    current.value = 2;
    const init = await http.post<{ sessionId: string }>('/cert/face-init', { certId: ocr.certId });
    current.value = 3;
    await http.post('/cert/face-verify', { sessionId: init.sessionId });
    passed.value = true;
    uni.showToast({ title: '实名认证通过', icon: 'none' });
  } catch {
    current.value = -1;
  } finally {
    running.value = false;
  }
}

function back() {
  uni.navigateBack();
}
</script>

<template>
  <view class="page">
    <text class="title">实名认证</text>
    <text class="sub">按照公安库标准核验身份，照片仅用于核验、不留存原文</text>

    <view v-for="(s, i) in steps" :key="s" class="step">
      <text class="dot" :class="{ on: passed || current >= i }">{{ passed || current > i ? '✓' : current === i ? '…' : '' }}</text>
      <text class="step-label" :class="{ dim: !passed && current < i }">{{ i + 1 }}. {{ s }}</text>
    </view>

    <text v-if="masked" class="masked">识别结果：{{ masked }}</text>

    <button v-if="!passed" class="big-btn" :loading="running" @click="go">开始认证（模拟）</button>
    <button v-else class="big-btn green" @click="back">认证完成，返回</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.step { display: flex; align-items: center; margin-top: 40rpx; }
.dot { width: 56rpx; height: 56rpx; border-radius: 50%; border: 3rpx solid #ccc; color: #fff; text-align: center; line-height: 52rpx; font-size: 32rpx; margin-right: 24rpx; }
.dot.on { background: #4caf50; border-color: #4caf50; }
.step-label { font-size: 36rpx; color: #222; }
.step-label.dim { color: #aaa; }
.masked { display: block; margin-top: 32rpx; font-size: 30rpx; color: #888; }
.big-btn { margin-top: 64rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.big-btn.green { background: #4caf50; }
</style>
