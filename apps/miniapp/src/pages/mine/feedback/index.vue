<script setup lang="ts">
import { ref } from 'vue';
import { http } from '@/api/http';

// 意见反馈（PRD §5.13 工单）：POST /tickets {type:'FEEDBACK', content}
const content = ref('');
const submitting = ref(false);

async function submit() {
  const text = content.value.trim();
  if (text.length < 5) {
    uni.showToast({ title: '请至少写 5 个字，方便我们处理', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await http.post('/tickets', { type: 'FEEDBACK', content: text });
    uni.showModal({
      title: '提交成功',
      content: '感谢您的反馈，客服会尽快处理，结果可在系统消息中查看。',
      showCancel: false,
      success: () => {
        content.value = '';
        uni.navigateBack();
      },
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <text class="title">意见反馈</text>
    <text class="sub">使用中遇到的问题或对平台的建议，都可以写在这里</text>

    <textarea v-model="content" class="ta" placeholder="请描述您遇到的问题或建议…" placeholder-class="ph" maxlength="500" />
    <text class="count">{{ content.length }}/500</text>

    <text class="btn" :class="{ off: submitting }" @click="submit">{{ submitting ? '提交中…' : '提交反馈' }}</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 30rpx; color: #555; }
.ta { display: block; width: 100%; box-sizing: border-box; margin-top: 28rpx; padding: 24rpx; background: #fff; border-radius: 16rpx; font-size: 34rpx; color: #222; height: 360rpx; }
.ph { color: #bbb; }
.count { display: block; margin-top: 12rpx; text-align: right; font-size: 26rpx; color: #999; }
.btn { display: block; margin-top: 40rpx; text-align: center; padding: 26rpx 0; font-size: 36rpx; color: #fff; background: #e64340; border-radius: 16rpx; font-weight: bold; }
.btn.off { opacity: 0.6; }
</style>
