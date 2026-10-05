<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { http } from '@/api/http';
import { EDUCATION_OPTIONS, labelOf } from '@/api/options';

// 我的档案（PRD §5.8 D1 多档案）：列表 + 切换生效 + 预览 + 新建
interface ProfileFull {
  id: string;
  matchNo: string;
  isActive: boolean;
  auditStatus: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  gender: string;
  birthYear: number;
  heightCm: number;
  education: string;
  occupation: string;
  residenceCity: string;
  consentStatus: 'NOT_REQUIRED' | 'PENDING' | 'DONE';
}

const items = ref<ProfileFull[]>([]);
const loading = ref(false);

const auditText: Record<string, string> = { DRAFT: '草稿', PENDING: '审核中', APPROVED: '已通过', REJECTED: '未通过' };
const auditClass: Record<string, string> = { DRAFT: 'gray', PENDING: 'orange', APPROVED: 'green', REJECTED: 'red' };

async function load() {
  loading.value = true;
  try {
    const res = await http.get<{ items: ProfileFull[] }>('/profiles', { toast: false });
    items.value = res.items;
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}
onShow(load);

function switchActive(p: ProfileFull) {
  if (p.isActive) return;
  uni.showModal({
    title: '切换生效档案',
    content: `确定让编号 ${p.matchNo} 的档案生效吗？切换不影响您已有的解锁和聊天。`,
    success: async (r) => {
      if (!r.confirm) return;
      await http.put('/profiles/active', { profileId: p.id });
      uni.showToast({ title: '已切换', icon: 'success' });
      void load();
    },
  });
}

function preview(p: ProfileFull) {
  uni.navigateTo({ url: `/pages/profile/preview/index?profileId=${p.id}` });
}

function createNew() {
  uni.navigateTo({ url: '/pages/profile/relation/index' });
}
</script>

<template>
  <view class="page">
    <text class="title">我的档案</text>
    <text class="sub">档案生效中才会出现在推荐里，为每位子女各建一份</text>

    <view v-for="p in items" :key="p.id" class="card" @click="preview(p)">
      <view class="row1">
        <text class="no">{{ p.matchNo }}</text>
        <text class="badge" :class="auditClass[p.auditStatus]">{{ auditText[p.auditStatus] }}</text>
        <text v-if="p.isActive" class="badge active">生效中</text>
      </view>
      <text class="meta">{{ p.gender === 'MALE' ? '男' : '女' }} · {{ p.birthYear }}年 · {{ p.heightCm }}cm · {{ labelOf(EDUCATION_OPTIONS, p.education) }} · {{ p.occupation }} · {{ p.residenceCity }}</text>
      <text v-if="p.auditStatus === 'REJECTED' && p.rejectReason" class="reject">未通过原因：{{ p.rejectReason }}</text>
      <view class="ops">
        <text v-if="p.auditStatus === 'DRAFT' || p.auditStatus === 'REJECTED'" class="op" @click.stop="preview(p)">去完善</text>
        <text v-else-if="!p.isActive && p.auditStatus === 'APPROVED'" class="op" @click.stop="switchActive(p)">设为生效</text>
        <text class="op ghost" @click.stop="preview(p)">预览</text>
      </view>
    </view>

    <text v-if="!loading && !items.length" class="empty">还没有档案，点击下方按钮为子女建档</text>

    <button class="big-btn" @click="createNew">＋ 新建档案</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx 32rpx 64rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 30rpx; color: #555; }
.card { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.row1 { display: flex; align-items: center; }
.no { font-size: 36rpx; font-weight: bold; color: #222; margin-right: 16rpx; }
.badge { font-size: 24rpx; border-radius: 8rpx; padding: 4rpx 14rpx; margin-right: 12rpx; }
.badge.gray { color: #666; background: #f0f0f0; }
.badge.orange { color: #e65100; background: #fff3e0; }
.badge.green { color: #2e7d32; background: #e8f5e9; }
.badge.red { color: #c62828; background: #ffebee; }
.badge.active { color: #fff; background: #e64340; }
.meta { display: block; margin-top: 12rpx; font-size: 28rpx; color: #666; }
.reject { display: block; margin-top: 10rpx; font-size: 28rpx; color: #c62828; }
.ops { display: flex; margin-top: 20rpx; }
.op { font-size: 30rpx; color: #e64340; margin-right: 40rpx; }
.op.ghost { color: #1976f2; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
.big-btn { margin-top: 40rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
