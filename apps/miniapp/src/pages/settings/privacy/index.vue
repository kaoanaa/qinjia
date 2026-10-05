<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 隐私设置（PRD §5.8）：仅同城可见 / 子女协助管理（≥配置阈值支付通知子女）
const cityOnly = ref(false);
const bigPay = ref(false);
const loaded = ref(false);

onShow(async () => {
  const res = await http.get<{ cityOnlyVisible: boolean; bigPayNotifyChild: boolean }>('/settings/privacy', { toast: false }).catch(() => null);
  if (res) {
    cityOnly.value = res.cityOnlyVisible;
    bigPay.value = res.bigPayNotifyChild;
    loaded.value = true;
  }
});

async function save() {
  await http.put('/settings/privacy', { cityOnlyVisible: cityOnly.value, bigPayNotifyChild: bigPay.value });
  uni.showToast({ title: '已保存', icon: 'success' });
}
</script>

<template>
  <view class="page">
    <text class="title">隐私设置</text>

    <view class="card">
      <view class="item">
        <view class="txt">
          <text class="name">仅同城可见</text>
          <text class="desc">开启后，只有和您同城的亲家能在推荐中看到您</text>
        </view>
        <switch :checked="cityOnly" color="#e64340" @change="(e: any) => (cityOnly = e.detail.value)" />
      </view>
      <view class="item">
        <view class="txt">
          <text class="name">子女协助管理</text>
          <text class="desc">开启后，大额支付会同时通知子女，家人帮您把关</text>
        </view>
        <switch :checked="bigPay" color="#e64340" @change="(e: any) => (bigPay = e.detail.value)" />
      </view>
    </view>

    <button v-if="loaded" class="big-btn" @click="save">保存设置</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.card { margin-top: 24rpx; background: #fff; border-radius: 20rpx; padding: 0 28rpx; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 32rpx 0; border-bottom: 2rpx solid #f5f5f5; }
.item:last-child { border-bottom: none; }
.txt { flex: 1; margin-right: 24rpx; }
.name { display: block; font-size: 36rpx; color: #222; font-weight: bold; }
.desc { display: block; margin-top: 8rpx; font-size: 28rpx; color: #888; line-height: 1.5; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
