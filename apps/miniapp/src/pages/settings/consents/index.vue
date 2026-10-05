<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 子女授权管理（PRD §5.8，PIPL）：列表 + 撤回（撤回后档案下架，重新发布需再授权）
interface Consent {
  consentId: string;
  profileId: string;
  matchNo: string;
  relation: string;
  childPhoneMasked: string;
  statementVersion: string;
  activeProfile: boolean;
  createdAt: string;
}
const items = ref<Consent[]>([]);

onShow(async () => {
  const res = await http.get<{ items: Consent[] }>('/settings/consents', { toast: false }).catch(() => null);
  items.value = res?.items ?? [];
});

function revoke(c: Consent) {
  uni.showModal({
    title: '确认撤回授权',
    content: `撤回后，编号 ${c.matchNo} 的档案将立即下架；子女需重新授权才能再次发布。确定撤回吗？`,
    confirmText: '确认撤回',
    cancelText: '再想想',
    success: async (r) => {
      if (!r.confirm) return;
      await http.del(`/settings/consents/${c.consentId}`);
      uni.showToast({ title: '已撤回', icon: 'success' });
      const res = await http.get<{ items: Consent[] }>('/settings/consents');
      items.value = res.items;
    },
  });
}
</script>

<template>
  <view class="page">
    <text class="title">子女授权管理</text>
    <text class="sub">代子女建档需子女本人短信授权；您可随时撤回</text>

    <view v-for="c in items" :key="c.consentId" class="card">
      <view class="row1">
        <text class="no">编号 {{ c.matchNo }}</text>
        <text v-if="c.activeProfile" class="badge">生效中</text>
      </view>
      <text class="meta">授权手机：{{ c.childPhoneMasked }} · 声明版本 {{ c.statementVersion }}</text>
      <text class="meta">授权时间：{{ c.createdAt.slice(0, 10) }}</text>
      <text class="revoke" @click="revoke(c)">撤回授权</text>
    </view>

    <text v-if="!items.length" class="empty">暂无授权记录</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 30rpx; color: #555; }
.card { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.row1 { display: flex; align-items: center; }
.no { font-size: 36rpx; font-weight: bold; color: #222; }
.badge { margin-left: 16rpx; font-size: 24rpx; color: #4caf50; background: #e8f5e9; border-radius: 8rpx; padding: 4rpx 14rpx; }
.meta { display: block; margin-top: 12rpx; font-size: 28rpx; color: #666; }
.revoke { display: inline-block; margin-top: 20rpx; font-size: 30rpx; color: #e64340; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
