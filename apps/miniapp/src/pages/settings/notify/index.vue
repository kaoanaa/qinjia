<script setup lang="ts">
import { reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';

// 通知设置（PRD §5.8）：开关集合 + 订阅消息授权状态
interface NotifyPref {
  switches: Record<string, boolean>;
  subscribeAuthStatus: 'UNKNOWN' | 'GRANTED' | 'DENIED';
}
const switches = reactive<Record<string, boolean>>({ review: true, expireRemind: true, activity: true, rewardArrived: true, im: true });
const subscribe = ref<NotifyPref['subscribeAuthStatus']>('UNKNOWN');
const loaded = ref(false);

const items = [
  { key: 'review', name: '审核结果通知', desc: '档案审核通过/不通过时提醒' },
  { key: 'expireRemind', name: '到期提醒', desc: '解锁或会员快到期时提醒' },
  { key: 'activity', name: '新消息互动提醒', desc: '有人打招呼、回复时提醒' },
  { key: 'rewardArrived', name: '奖励到账通知', desc: '邀请奖励、优惠券到账时提醒' },
  { key: 'im', name: '聊天消息提醒', desc: '离线消息补达开关' },
];

onShow(async () => {
  const res = await http.get<NotifyPref>('/settings/notify', { toast: false }).catch(() => null);
  if (res) {
    Object.keys(switches).forEach((k) => (switches[k] = res.switches[k] ?? true));
    subscribe.value = res.subscribeAuthStatus;
    loaded.value = true;
  }
});

async function save() {
  await http.put('/settings/notify', { switches: { ...switches } });
  uni.showToast({ title: '已保存', icon: 'success' });
}

function subscribeTip(s: string) {
  return s === 'GRANTED' ? '已授权，重要消息将通过微信服务通知送达' : s === 'DENIED' ? '曾拒绝授权，可在微信“设置-订阅消息”中重新开启' : '尚未授权，首次重要通知时会请您确认';
}
</script>

<template>
  <view class="page">
    <text class="title">通知设置</text>

    <view class="card">
      <view v-for="it in items" :key="it.key" class="item">
        <view class="txt">
          <text class="name">{{ it.name }}</text>
          <text class="desc">{{ it.desc }}</text>
        </view>
        <switch :checked="switches[it.key]" color="#e64340" @change="(e: any) => (switches[it.key] = e.detail.value)" />
      </view>
    </view>

    <view class="sub-card">
      <text class="sub-title">微信服务通知</text>
      <text class="sub-desc">{{ subscribeTip(subscribe) }}</text>
    </view>

    <button v-if="loaded" class="big-btn" @click="save">保存设置</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.card { margin-top: 24rpx; background: #fff; border-radius: 20rpx; padding: 0 28rpx; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 0; border-bottom: 2rpx solid #f5f5f5; }
.item:last-child { border-bottom: none; }
.txt { flex: 1; margin-right: 24rpx; }
.name { display: block; font-size: 34rpx; color: #222; }
.desc { display: block; margin-top: 6rpx; font-size: 26rpx; color: #888; }
.sub-card { margin-top: 24rpx; padding: 28rpx; background: #fff8f0; border-radius: 16rpx; }
.sub-title { display: block; font-size: 32rpx; color: #e65100; font-weight: bold; }
.sub-desc { display: block; margin-top: 8rpx; font-size: 28rpx; color: #7a5c3e; line-height: 1.5; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
