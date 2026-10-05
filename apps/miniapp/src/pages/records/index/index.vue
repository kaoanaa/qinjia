<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 我的记录（PRD §5.13/§6.1）：GET /unlock/records（我发起的 + 被动获得的）
interface Rec {
  id: string;
  direction: 'initiated_by_me' | 'granted_to_me';
  targetProfile: string;
  payType: string;
  status: string;
  createdAt: string;
  expireAt: string;
}

const items = ref<Rec[]>([]);

onShow(async () => {
  const res = await http.get<{ items?: Rec[]; total?: number }>('/unlock/records?size=50').catch(() => null);
  items.value = Array.isArray(res) ? (res as unknown as Rec[]) : res?.items ?? [];
});

const payText: Record<string, string> = { QUOTA: '解锁次数', ONCE: '单次付费', FREE_GRANT: '对方授权（免费）' };
const statusText: Record<string, string> = { ACTIVE: '有效', EXPIRED: '已过期', REFUNDED: '已退款' };
</script>

<template>
  <view class="page">
    <text class="title">解锁记录</text>

    <view v-for="r in items" :key="r.id" class="rec">
      <view class="row1">
        <text class="who">{{ r.targetProfile }}</text>
        <text class="st" :class="{ dim: r.status !== 'ACTIVE' }">{{ statusText[r.status] || r.status }}</text>
      </view>
      <text class="row2">{{ r.direction === 'initiated_by_me' ? '我解锁了对方' : '对方解锁了我' }} · {{ payText[r.payType] || r.payType }}</text>
      <text class="row3">{{ r.createdAt.slice(0, 10) }} 至 {{ r.expireAt.slice(0, 10) }}</text>
    </view>

    <text v-if="!items.length" class="empty">还没有解锁记录</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.rec { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 16rpx; }
.row1 { display: flex; justify-content: space-between; }
.who { font-size: 36rpx; font-weight: bold; color: #222; }
.st { font-size: 26rpx; color: #4caf50; background: #e8f5e9; border-radius: 8rpx; padding: 4rpx 12rpx; }
.st.dim { color: #999; background: #f2f2f2; }
.row2 { display: block; margin-top: 10rpx; font-size: 30rpx; color: #555; }
.row3 { display: block; margin-top: 6rpx; font-size: 26rpx; color: #999; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
