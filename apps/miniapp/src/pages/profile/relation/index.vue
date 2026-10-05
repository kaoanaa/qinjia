<script setup lang="ts">
import { ref } from 'vue';

// 选择关系（PRD §5.2 主链路第 1 步）：父/母代建 or 本人自述；relation 随建档表单提交落库
const relation = ref(uni.getStorageSync('qj_relation') || '');

const options = [
  { value: 'FATHER', label: '我是孩子的父亲' },
  { value: 'MOTHER', label: '我是孩子的母亲' },
  { value: 'SELF', label: '我本人找对象' },
];

function next() {
  if (!relation.value) {
    uni.showToast({ title: '请先选择您的身份', icon: 'none' });
    return;
  }
  uni.setStorageSync('qj_relation', relation.value);
  uni.navigateTo({ url: '/pages/profile/form/index' });
}
</script>

<template>
  <view class="page">
    <text class="title">您是谁？</text>
    <text class="sub">请选择后为孩子（或您本人）建立档案</text>

    <view
      v-for="o in options"
      :key="o.value"
      class="opt"
      :class="{ active: relation === o.value }"
      @click="relation = o.value"
    >
      <text class="opt-label">{{ o.label }}</text>
      <text v-if="relation === o.value" class="opt-check">✓</text>
    </view>

    <button class="big-btn" @click="next">下一步，填写资料</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.opt { display: flex; justify-content: space-between; align-items: center; margin-top: 32rpx; padding: 40rpx 32rpx; background: #fff; border: 4rpx solid #eee; border-radius: 20rpx; }
.opt.active { border-color: #e64340; background: #fff5f5; }
.opt-label { font-size: 40rpx; color: #222; }
.opt-check { font-size: 44rpx; color: #e64340; font-weight: bold; }
.big-btn { margin-top: 64rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
