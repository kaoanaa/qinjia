<script setup lang="ts">
import { ref } from 'vue';
import { http } from '@/api/http';

// 防诈骗指南（PRD §5.13）：顶部警示读运营位配置（红线 I1，话术不硬编码），下方为固定安全提示清单
interface Slot { id: string; content: { title?: string; text?: string } }

const tips = ref<Slot[]>([]);

async function load() {
  const res = await http.get<Slot[]>('/ops/slots?type=BANNER', { toast: false }).catch(() => null);
  tips.value = res ?? [];
}
load();

const checklist = [
  '任何以「见面费」「保证金」「解冻费」为由要您转账汇款的，都是诈骗。',
  '不要透露银行卡号、密码、短信验证码；平台工作人员绝不会向您索要。',
  '刚认识就带您「投资理财、刷单返利」的，都是骗局，请立即停止联系并举报。',
  '解锁联系方式前后，都不要在聊天中发送身份证号、户口本等敏感证件照片。',
  '首次见面请选择白天、人多的公共场所，并告知家人朋友您的去向。',
];
</script>

<template>
  <view class="page">
    <text class="title">防诈骗指南</text>
    <text class="sub">请您牢记以下提醒，谨防上当受骗</text>

    <view v-for="s in tips" :key="s.id" class="alert">
      <text class="alert-title">{{ s.content.title }}</text>
      <text class="alert-text">{{ s.content.text }}</text>
    </view>

    <view class="list">
      <view v-for="(c, i) in checklist" :key="i" class="item">
        <text class="no">{{ i + 1 }}</text>
        <text class="txt">{{ c }}</text>
      </view>
    </view>

    <view class="report">
      <text class="report-text">如遇诈骗或发现可疑行为，请点击对方资料页右上角「举报」，或联系客服。</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx 32rpx 64rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 12rpx; font-size: 30rpx; color: #777; }
.alert { margin-top: 28rpx; padding: 28rpx; background: #fff3e0; border-radius: 16rpx; }
.alert-title { display: block; font-size: 36rpx; font-weight: bold; color: #e65100; }
.alert-text { display: block; margin-top: 10rpx; font-size: 34rpx; color: #bf360c; line-height: 1.6; }
.list { margin-top: 28rpx; background: #fff; border-radius: 20rpx; padding: 8rpx 28rpx; }
.item { display: flex; padding: 26rpx 0; border-bottom: 2rpx solid #f2f2f2; }
.item:last-child { border-bottom: none; }
.no { width: 56rpx; height: 56rpx; line-height: 56rpx; text-align: center; background: #e64340; color: #fff; border-radius: 50%; font-size: 32rpx; flex-shrink: 0; margin-right: 24rpx; }
.txt { flex: 1; font-size: 34rpx; color: #333; line-height: 1.6; }
.report { margin-top: 32rpx; padding: 24rpx 28rpx; background: #f7f9ff; border-radius: 16rpx; }
.report-text { font-size: 32rpx; color: #33507e; line-height: 1.6; }
</style>
