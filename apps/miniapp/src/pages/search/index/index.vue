<script setup lang="ts">
import { ref } from 'vue';
import { onShow, onReachBottom } from '@dcloudio/uni-app';
import { http } from '@/api/http';
import { EDUCATION_OPTIONS, INCOME_OPTIONS } from '@/api/options';

// 精准搜索（PRD §5.4）：GET /search 多维筛选，服务端裁决 cityOnlyVisible
const city = ref('');
const gender = ref('');
const ageMin = ref('');
const ageMax = ref('');
const heightMin = ref('');
const heightMax = ref('');
const education = ref('');
const incomeRange = ref('');

const eduIdx = ref(-1);
const incIdx = ref(-1);

const items = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);
const searched = ref(false);
const loading = ref(false);

async function search(next = 1) {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (city.value) q.set('city', city.value);
    if (gender.value) q.set('gender', gender.value);
    if (ageMin.value) q.set('ageMin', ageMin.value);
    if (ageMax.value) q.set('ageMax', ageMax.value);
    if (heightMin.value) q.set('heightMin', heightMin.value);
    if (heightMax.value) q.set('heightMax', heightMax.value);
    if (eduIdx.value >= 0) q.set('education', EDUCATION_OPTIONS[eduIdx.value].value);
    if (incIdx.value >= 0) q.set('incomeRange', INCOME_OPTIONS[incIdx.value].value);
    q.set('page', String(next));
    q.set('size', '10');
    const res = await http.get<{ total: number; items: Record<string, unknown>[] }>(`/search?${q.toString()}`, { toast: false });
    items.value = next === 1 ? res.items : [...items.value, ...res.items];
    total.value = res.total;
    page.value = next;
    searched.value = true;
  } catch {
    items.value = next === 1 ? [] : items.value;
    total.value = next === 1 ? 0 : total.value;
    searched.value = true;
  } finally {
    loading.value = false;
  }
}
onShow(() => {
  if (!searched.value) return;
  void search(1);
});
onReachBottom(() => {
  if (searched.value && items.value.length < total.value) void search(page.value + 1);
});

function onEdu(e: { detail: { value: string } }) {
  eduIdx.value = Number(e.detail.value);
}
function onInc(e: { detail: { value: string } }) {
  incIdx.value = Number(e.detail.value);
}

function reset() {
  city.value = '';
  gender.value = '';
  ageMin.value = '';
  ageMax.value = '';
  heightMin.value = '';
  heightMax.value = '';
  eduIdx.value = -1;
  incIdx.value = -1;
}

function open(_profileId: string, matchNo: string) {
  uni.navigateTo({ url: `/pages/feed/detail/index?matchNo=${matchNo}` });
}
</script>

<template>
  <view class="page">
    <text class="title">精准搜索</text>

    <view class="form">
      <view class="row">
        <text class="lb">城市</text>
        <input v-model="city" class="ipt" placeholder="如：杭州" placeholder-class="ph" />
      </view>
      <view class="row">
        <text class="lb">性别</text>
        <view class="seg">
          <text class="seg-i" :class="{ on: gender === '' }" @click="gender = ''">不限</text>
          <text class="seg-i" :class="{ on: gender === 'FEMALE' }" @click="gender = 'FEMALE'">找女方</text>
          <text class="seg-i" :class="{ on: gender === 'MALE' }" @click="gender = 'MALE'">找男方</text>
        </view>
      </view>
      <view class="row">
        <text class="lb">年龄</text>
        <input v-model="ageMin" class="ipt half" type="number" placeholder="最小" placeholder-class="ph" />
        <text class="dash">-</text>
        <input v-model="ageMax" class="ipt half" type="number" placeholder="最大" placeholder-class="ph" />
      </view>
      <view class="row">
        <text class="lb">身高</text>
        <input v-model="heightMin" class="ipt half" type="number" placeholder="最低cm" placeholder-class="ph" />
        <text class="dash">-</text>
        <input v-model="heightMax" class="ipt half" type="number" placeholder="最高cm" placeholder-class="ph" />
      </view>
      <view class="row">
        <text class="lb">学历</text>
        <picker :range="EDUCATION_OPTIONS.map(o => o.label)" @change="onEdu">
          <view class="pick">{{ eduIdx >= 0 ? EDUCATION_OPTIONS[eduIdx].label : '不限' }}</view>
        </picker>
      </view>
      <view class="row">
        <text class="lb">收入</text>
        <picker :range="INCOME_OPTIONS.map(o => o.label)" @change="onInc">
          <view class="pick">{{ incIdx >= 0 ? INCOME_OPTIONS[incIdx].label : '不限' }}</view>
        </picker>
      </view>
      <view class="btns">
        <text class="btn ghost" @click="reset">重置</text>
        <text class="btn primary" @click="search(1)">{{ loading ? '搜索中…' : '搜索' }}</text>
      </view>
    </view>

    <text v-if="searched" class="res-tip">共找到 {{ total }} 位符合条件的亲家</text>
    <qj-card v-for="c in items" :key="(c as { profileId: string }).profileId" :card="c as never" @tap="open" />
    <text v-if="searched && !loading && !items.length" class="empty">没有符合条件的档案，试着放宽条件</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.form { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.row { display: flex; align-items: center; margin-bottom: 24rpx; }
.lb { width: 120rpx; font-size: 32rpx; color: #222; }
.ipt { flex: 1; font-size: 32rpx; color: #222; border-bottom: 2rpx solid #eee; padding: 12rpx 0; }
.ipt.half { flex: none; width: 180rpx; text-align: center; }
.dash { margin: 0 16rpx; color: #999; font-size: 32rpx; }
.ph { color: #bbb; }
.seg { flex: 1; display: flex; }
.seg-i { flex: 1; text-align: center; padding: 14rpx 0; font-size: 30rpx; color: #555; background: #f5f5f5; border-radius: 12rpx; margin-right: 16rpx; }
.seg-i.on { color: #fff; background: #e64340; font-weight: bold; }
.pick { font-size: 32rpx; color: #222; padding: 12rpx 0; border-bottom: 2rpx solid #eee; }
.btns { display: flex; margin-top: 8rpx; }
.btn { flex: 1; text-align: center; padding: 22rpx 0; font-size: 34rpx; border-radius: 16rpx; }
.btn.ghost { color: #555; background: #f2f2f2; margin-right: 24rpx; }
.btn.primary { color: #fff; background: #e64340; font-weight: bold; }
.res-tip { display: block; margin-top: 28rpx; font-size: 30rpx; color: #555; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
