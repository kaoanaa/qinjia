<script setup lang="ts">
// 推荐/墙/搜索通用档案卡（§5.3/§5.7 字段一致；昵称可选——墙带 nickname 字段）
import { EDUCATION_OPTIONS, INCOME_OPTIONS, labelOf } from '@/api/options';

const props = defineProps<{
  card: {
    profileId: string;
    matchNo: string;
    nickname?: string;
    gender: string;
    birthYear: number;
    heightCm: number;
    education: string;
    occupation: string;
    incomeRange: string;
    residenceCity: string;
    introDigest: string | null;
    memberBadge: boolean;
    maritalVerified: boolean;
    avatarUrl: string | null;
    unlocked?: boolean;
    rotationTip?: string | null;
  };
}>();

const emit = defineEmits<{ (e: 'tap', profileId: string, matchNo: string): void }>();

const age = (b: number) => new Date().getFullYear() - b;
</script>

<template>
  <view class="card" @click="emit('tap', props.card.profileId, props.card.matchNo)">
    <image v-if="card.avatarUrl" class="avatar" :src="card.avatarUrl" mode="aspectFill" />
    <view v-else class="avatar avatar-ph"><text>亲家</text></view>
    <view class="info">
      <view class="line1">
        <text class="match">{{ card.matchNo }}</text>
        <text v-if="card.nickname" class="nick">{{ card.nickname }}</text>
        <text v-if="card.memberBadge" class="badge">会员</text>
        <text class="vtag" :class="card.maritalVerified ? 'ok' : 'warn'">{{ card.maritalVerified ? '已核验' : '未核验' }}</text>
        <text v-if="card.unlocked" class="badge green">已解锁</text>
      </view>
      <text class="line2">{{ card.gender === 'FEMALE' ? '女' : '男' }} · {{ age(card.birthYear) }}岁 · {{ card.heightCm }}cm · {{ labelOf(EDUCATION_OPTIONS, card.education) }}</text>
      <text class="line3">{{ card.residenceCity }} · {{ card.occupation }} · {{ labelOf(INCOME_OPTIONS, card.incomeRange) }}</text>
      <text v-if="card.introDigest" class="line4">{{ card.introDigest }}</text>
      <text v-if="card.rotationTip" class="tip">{{ card.rotationTip }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.card { display: flex; margin-top: 28rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.avatar { width: 160rpx; height: 160rpx; border-radius: 16rpx; flex-shrink: 0; background: #eee; }
.avatar-ph { display: flex; align-items: center; justify-content: center; }
.avatar-ph text { font-size: 30rpx; color: #999; }
.info { flex: 1; margin-left: 24rpx; }
.line1 { display: flex; align-items: center; }
.match { font-size: 38rpx; font-weight: bold; color: #222; margin-right: 12rpx; }
.nick { font-size: 30rpx; color: #555; margin-right: 12rpx; }
.badge { font-size: 24rpx; color: #fff; background: #ff9800; border-radius: 8rpx; padding: 4rpx 12rpx; margin-right: 12rpx; }
.badge.green { background: #4caf50; }
.vtag { font-size: 24rpx; border-radius: 8rpx; padding: 4rpx 12rpx; }
.vtag.ok { color: #4caf50; background: #e8f5e9; }
.vtag.warn { color: #999; background: #f2f2f2; }
.line2 { display: block; margin-top: 12rpx; font-size: 34rpx; color: #222; }
.line3 { display: block; margin-top: 8rpx; font-size: 30rpx; color: #555; }
.line4 { display: block; margin-top: 8rpx; font-size: 30rpx; color: #777; }
.tip { display: block; margin-top: 8rpx; font-size: 28rpx; color: #e64340; }
</style>
