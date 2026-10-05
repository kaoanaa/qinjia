<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http } from '@/api/http';
import { EDUCATION_OPTIONS, INCOME_OPTIONS, MARITAL_OPTIONS, labelOf } from '@/api/options';

// 详细资料（PRD §5.4/§6.3）：照片两态与警示由服务端裁决下发（红线 I3）
interface Detail {
  profileId: string;
  matchNo: string;
  gender: string;
  age: number;
  birthYear: number;
  heightCm: number;
  education: string;
  occupation: string;
  incomeRange: string;
  maritalStatus?: string;
  housing?: string;
  car?: string;
  residenceCity: string;
  residenceDistrict: string | null;
  hometown: string | null;
  hukou: string | null;
  intro: string | null;
  relation: string;
  agentNickname: string;
  realnameSeal: boolean;
  memberBadge: boolean;
  maritalVerified: boolean;
  avatarUrl: string | null;
  photos: Array<{ url: string; blurred: boolean }>;
  unverifiedWarnTop: string | null;
  contactVisible: boolean;
  favorited: boolean;
  unlocked: boolean;
  prevMatchNo: string | null;
  nextMatchNo: string | null;
}

const d = ref<Detail | null>(null);
const busy = ref(false);

async function load(matchNo: string) {
  d.value = await http.get<Detail>(`/feed/public/${matchNo}`);
}

onLoad(async (q) => {
  const matchNo = (q as { matchNo?: string })?.matchNo;
  if (matchNo) await load(matchNo);
});

function switchTo(matchNo: string | null) {
  if (matchNo) void load(matchNo);
}

async function toggleFavorite() {
  if (!d.value) return;
  const res = await http.post<{ favorited: boolean }>('/favorites', { profileId: d.value.profileId });
  d.value.favorited = res.favorited;
  uni.showToast({ title: res.favorited ? '已收藏' : '已取消收藏', icon: 'none' });
}

async function greet() {
  if (!d.value) return;
  await http.post('/greet', { profileId: d.value.profileId });
  uni.showToast({ title: '已跟对方打招呼', icon: 'none' });
}

function goUnlock() {
  if (!d.value) return;
  uni.navigateTo({ url: `/pages/unlock/paywall/index?profileId=${d.value.profileId}&matchNo=${d.value.matchNo}&unverified=${d.value.maritalVerified ? '' : '1'}` });
}

const edu = (v: string) => labelOf(EDUCATION_OPTIONS, v);
const income = (v: string) => labelOf(INCOME_OPTIONS, v);
const marital = (v?: string) => (v ? labelOf(MARITAL_OPTIONS, v) : '未填写');
</script>

<template>
  <view v-if="d" class="page">
    <text v-if="d.unverifiedWarnTop" class="warn">{{ d.unverifiedWarnTop }}</text>

    <view class="head">
      <image v-if="d.avatarUrl" class="avatar" :src="d.avatarUrl" mode="aspectFill" />
      <view class="head-info">
        <view class="line1">
          <text class="match">{{ d.matchNo }}</text>
          <text v-if="d.memberBadge" class="badge">会员</text>
          <text v-if="d.realnameSeal" class="seal">已实名</text>
        </view>
        <text class="line2">{{ d.gender === 'FEMALE' ? '女' : '男' }} · {{ d.age }}岁 · {{ d.heightCm }}cm</text>
        <text class="line3">由 {{ d.agentNickname }}（{{ d.relation === 'SELF' ? '本人' : d.relation === 'MOTHER' ? '母亲' : '父亲' }}）发布</text>
      </view>
    </view>

    <view class="photos">
      <image v-for="(p, i) in d.photos" :key="i" class="photo" :src="p.url" mode="aspectFill" />
      <text v-if="d.photos.length && d.photos[0].blurred" class="photo-tip">照片解锁后可看清</text>
    </view>

    <view class="facts">
      <view class="fact"><text class="k">学历</text><text class="v">{{ edu(d.education) }}</text></view>
      <view class="fact"><text class="k">职业</text><text class="v">{{ d.occupation }}</text></view>
      <view class="fact"><text class="k">月收入</text><text class="v">{{ income(d.incomeRange) }}</text></view>
      <view class="fact"><text class="k">婚姻状况</text><text class="v">{{ marital(d.maritalStatus) }}{{ d.maritalVerified ? '（已核验）' : '（未核验）' }}</text></view>
      <view class="fact"><text class="k">现居</text><text class="v">{{ d.residenceCity }}{{ d.residenceDistrict ? ' ' + d.residenceDistrict : '' }}</text></view>
      <view class="fact"><text class="k">老家</text><text class="v">{{ d.hometown || '未填写' }}</text></view>
      <view class="fact"><text class="k">户籍</text><text class="v">{{ d.hukou || '未填写' }}</text></view>
    </view>

    <view v-if="d.intro" class="intro"><text class="k">家长寄语</text><text class="intro-text">{{ d.intro }}</text></view>

    <button v-if="!d.contactVisible" class="big-btn" @click="goUnlock">解锁联系方式</button>
    <view v-else class="unlocked-hint">
      <text class="ok">已解锁，可查看对方联系方式</text>
      <button class="mini-btn" @click="goUnlock">查看</button>
    </view>

    <view class="actions">
      <button class="act" :class="{ on: d.favorited }" :disabled="busy" @click="toggleFavorite">{{ d.favorited ? '已收藏' : '收藏' }}</button>
      <button class="act" :disabled="busy" @click="greet">打招呼</button>
    </view>

    <view class="nav">
      <text class="nav-btn" :class="{ off: !d.prevMatchNo }" @click="switchTo(d.prevMatchNo)">上一个</text>
      <text class="nav-btn" :class="{ off: !d.nextMatchNo }" @click="switchTo(d.nextMatchNo)">下一个</text>
    </view>
  </view>
  <view v-else class="page"><text class="sub">加载中…</text></view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx 32rpx 64rpx; }
.warn { display: block; padding: 24rpx; background: #fff3e0; color: #e65100; font-size: 32rpx; border-radius: 12rpx; margin-bottom: 24rpx; }
.head { display: flex; background: #fff; border-radius: 20rpx; padding: 28rpx; }
.avatar { width: 150rpx; height: 150rpx; border-radius: 16rpx; background: #eee; }
.head-info { flex: 1; margin-left: 24rpx; }
.line1 { display: flex; align-items: center; }
.match { font-size: 40rpx; font-weight: bold; color: #222; margin-right: 12rpx; }
.badge { font-size: 24rpx; color: #fff; background: #ff9800; border-radius: 8rpx; padding: 4rpx 12rpx; margin-right: 12rpx; }
.seal { font-size: 24rpx; color: #4caf50; background: #e8f5e9; border-radius: 8rpx; padding: 4rpx 12rpx; }
.line2 { display: block; margin-top: 12rpx; font-size: 34rpx; color: #222; }
.line3 { display: block; margin-top: 8rpx; font-size: 28rpx; color: #777; }
.photos { display: flex; flex-wrap: wrap; margin-top: 24rpx; }
.photo { width: 210rpx; height: 210rpx; border-radius: 12rpx; margin: 0 16rpx 16rpx 0; background: #eee; }
.photo-tip { width: 100%; font-size: 26rpx; color: #999; }
.facts { margin-top: 8rpx; background: #fff; border-radius: 20rpx; padding: 8rpx 28rpx; }
.fact { display: flex; padding: 24rpx 0; border-bottom: 2rpx solid #f2f2f2; }
.fact:last-child { border-bottom: none; }
.k { width: 200rpx; font-size: 34rpx; color: #777; }
.v { flex: 1; font-size: 34rpx; color: #222; }
.intro { margin-top: 24rpx; background: #fff; border-radius: 20rpx; padding: 28rpx; }
.intro-text { display: block; margin-top: 12rpx; font-size: 34rpx; color: #333; line-height: 1.7; }
.big-btn { margin-top: 40rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
.unlocked-hint { display: flex; align-items: center; justify-content: space-between; margin-top: 40rpx; background: #e8f5e9; border-radius: 16rpx; padding: 24rpx 32rpx; }
.ok { font-size: 34rpx; color: #2e7d32; }
.mini-btn { width: 220rpx; height: 72rpx; line-height: 72rpx; background: #4caf50; color: #fff; font-size: 30rpx; border-radius: 36rpx; }
.actions { display: flex; margin-top: 32rpx; }
.act { flex: 1; margin: 0 12rpx; height: 88rpx; line-height: 88rpx; background: #fff; color: #333; border: 2rpx solid #ddd; font-size: 32rpx; border-radius: 44rpx; }
.act.on { color: #e64340; border-color: #e64340; }
.nav { display: flex; justify-content: space-between; margin-top: 40rpx; }
.nav-btn { font-size: 32rpx; color: #1976f2; padding: 16rpx 32rpx; }
.nav-btn.off { color: #ccc; }
</style>
