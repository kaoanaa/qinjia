<script setup lang="ts">
import { ref } from 'vue';
import { onShow, onReachBottom } from '@dcloudio/uni-app';
import { http, type ApiError } from '@/api/http';
import { EDUCATION_OPTIONS, INCOME_OPTIONS, labelOf } from '@/api/options';

// 今日推荐（PRD §5.3）：GET /feed；卡片字段全部服务端下发（打码头像/徽章/轮换提示）
interface FeedCard {
  profileId: string;
  matchNo: string;
  gender: string;
  birthYear: number;
  heightCm: number;
  education: string;
  occupation: string;
  incomeRange: string;
  residenceCity: string;
  residenceDistrict: string | null;
  introDigest: string | null;
  memberBadge: boolean;
  maritalVerified: boolean;
  avatarUrl: string | null;
  todayOnly: boolean;
  rotationTip: string | null;
  unlocked: boolean;
}

const items = ref<FeedCard[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const needProfile = ref(false);

async function load(next = 1) {
  if (loading.value) return;
  loading.value = true;
  try {
    const res = await http.get<{ total: number; items: FeedCard[] }>(`/feed?page=${next}&size=10`, { toast: next === 1 });
    items.value = next === 1 ? res.items : [...items.value, ...res.items];
    total.value = res.total;
    page.value = next;
    needProfile.value = false;
  } catch (e) {
    if ((e as ApiError).errorCode === 'NEED_ACTIVE_PROFILE') needProfile.value = true;
  } finally {
    loading.value = false;
  }
}

onShow(() => load(1));
onReachBottom(() => {
  if (items.value.length < total.value) load(page.value + 1);
});

const eduText = (v: string) => labelOf(EDUCATION_OPTIONS, v);
const incomeText = (v: string) => labelOf(INCOME_OPTIONS, v);
const age = (b: number) => new Date().getFullYear() - b;

function openDetail(c: FeedCard) {
  uni.navigateTo({ url: `/pages/feed/detail/index?matchNo=${c.matchNo}` });
}
</script>

<template>
  <view class="page">
    <text class="title">今日推荐</text>
    <text class="sub">每天更新，帮孩子挑一挑合眼缘的亲家</text>

    <view v-if="needProfile" class="empty">
      <text class="empty-big">还没有生效中的档案</text>
      <text class="empty-sub">先去建立孩子档案，才能收到推荐</text>
      <button class="btn" @click="uni.navigateTo({ url: '/pages/profile/relation/index' })">去建档</button>
    </view>

    <view v-for="c in items" :key="c.profileId" class="card" @click="openDetail(c)">
      <image v-if="c.avatarUrl" class="avatar" :src="c.avatarUrl" mode="aspectFill" />
      <view v-else class="avatar avatar-ph"><text>亲家</text></view>
      <view class="info">
        <view class="line1">
          <text class="match">{{ c.matchNo }}</text>
          <text v-if="c.memberBadge" class="badge">会员</text>
          <text class="vtag" :class="c.maritalVerified ? 'ok' : 'warn'">{{ c.maritalVerified ? '婚姻已核验' : '未核验' }}</text>
          <text v-if="c.unlocked" class="badge green">已解锁</text>
        </view>
        <text class="line2">{{ c.gender === 'FEMALE' ? '女' : '男' }} · {{ age(c.birthYear) }}岁 · {{ c.heightCm }}cm · {{ eduText(c.education) }}</text>
        <text class="line3">{{ c.residenceCity }}{{ c.residenceDistrict ? ' ' + c.residenceDistrict : '' }} · {{ c.occupation }} · {{ incomeText(c.incomeRange) }}</text>
        <text v-if="c.introDigest" class="line4">{{ c.introDigest }}</text>
        <text v-if="c.rotationTip" class="tip">{{ c.rotationTip }}</text>
      </view>
    </view>

    <text v-if="!loading && !items.length && !needProfile" class="sub">今天还没有合适的推荐，明天再看看</text>
    <text v-if="items.length && items.length < total" class="more">上拉加载更多（{{ items.length }}/{{ total }}）</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.card { display: flex; margin-top: 28rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.avatar { width: 160rpx; height: 160rpx; border-radius: 16rpx; flex-shrink: 0; background: #eee; }
.avatar-ph { display: flex; align-items: center; justify-content: center; }
.avatar-ph text { font-size: 30rpx; color: #999; }
.info { flex: 1; margin-left: 24rpx; }
.line1 { display: flex; align-items: center; }
.match { font-size: 38rpx; font-weight: bold; color: #222; margin-right: 12rpx; }
.badge { font-size: 24rpx; color: #fff; background: #ff9800; border-radius: 8rpx; padding: 4rpx 12rpx; margin-right: 12rpx; }
.badge.green { background: #4caf50; }
.vtag { font-size: 24rpx; border-radius: 8rpx; padding: 4rpx 12rpx; }
.vtag.ok { color: #4caf50; background: #e8f5e9; }
.vtag.warn { color: #999; background: #f2f2f2; }
.line2 { display: block; margin-top: 12rpx; font-size: 34rpx; color: #222; }
.line3 { display: block; margin-top: 8rpx; font-size: 30rpx; color: #555; }
.line4 { display: block; margin-top: 8rpx; font-size: 30rpx; color: #777; }
.tip { display: block; margin-top: 8rpx; font-size: 28rpx; color: #e64340; }
.more { display: block; margin-top: 32rpx; text-align: center; font-size: 28rpx; color: #888; }
.empty { margin-top: 80rpx; text-align: center; }
.empty-big { display: block; font-size: 40rpx; font-weight: bold; color: #333; }
.empty-sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #777; }
.btn { margin: 40rpx auto 0; width: 400rpx; height: 96rpx; line-height: 96rpx; background: #e64340; color: #fff; font-size: 36rpx; border-radius: 48rpx; }
</style>
