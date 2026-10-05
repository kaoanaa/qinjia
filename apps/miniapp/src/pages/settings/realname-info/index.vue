<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 实名信息（PRD §5.8，红线 I5：仅掩码回显）
interface Info {
  realnamePassed: boolean;
  idCardNoMasked: string | null;
  nameMasked: string | null;
  certifiedAt: string | null;
}
const info = ref<Info | null>(null);

onShow(async () => {
  info.value = await http.get<Info>('/settings/realname', { toast: false }).catch(() => null);
});

function goCert() {
  uni.navigateTo({ url: '/pages/cert/realname/index' });
}
</script>

<template>
  <view class="page">
    <text class="title">实名信息</text>

    <view v-if="info?.realnamePassed" class="card">
      <view class="item"><text class="k">状态</text><text class="v ok">已实名认证</text></view>
      <view class="item"><text class="k">姓名</text><text class="v">{{ info.nameMasked }}</text></view>
      <view class="item"><text class="k">身份证号</text><text class="v">{{ info.idCardNoMasked }}</text></view>
      <view class="item"><text class="k">认证时间</text><text class="v">{{ info.certifiedAt?.slice(0, 10) }}</text></view>
      <text class="tip">为保护您的隐私，身份证号与姓名仅展示掩码，平台无法被他人查看</text>
    </view>
    <view v-else class="card">
      <text class="none">您还未完成实名认证</text>
      <text class="tip">实名通过后才能解锁联系方式、发布档案</text>
      <button class="big-btn" @click="goCert">去认证</button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.card { margin-top: 32rpx; padding: 32rpx; background: #fff; border-radius: 20rpx; }
.item { display: flex; justify-content: space-between; padding: 24rpx 0; border-bottom: 2rpx solid #f5f5f5; }
.item:last-of-type { border-bottom: none; }
.k { font-size: 34rpx; color: #666; }
.v { font-size: 34rpx; color: #222; font-weight: bold; }
.v.ok { color: #4caf50; }
.tip { display: block; margin-top: 24rpx; font-size: 28rpx; color: #999; line-height: 1.6; }
.none { display: block; font-size: 36rpx; color: #222; }
.big-btn { margin-top: 40rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
