<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http } from '@/api/http';
import { EDUCATION_OPTIONS, INCOME_OPTIONS, MARITAL_OPTIONS, labelOf } from '@/api/options';

// 档案预览（PRD §5.2 所见即所得，本人视角）：GET /profiles/:profileId + 编辑入口
interface ProfileFull {
  id: string;
  matchNo: string;
  isActive: boolean;
  auditStatus: string;
  isMaritalVerified: boolean;
  relation: string;
  gender: string;
  birthYear: number;
  heightCm: number;
  education: string;
  occupation: string;
  incomeRange: string;
  maritalStatus: string;
  residenceCity: string;
  residenceDistrict: string | null;
  hometown: string | null;
  hukou: string | null;
  housing: string | null;
  car: string | null;
  intro: string | null;
  bodyType: string | null;
  expectHeightMin: number | null;
  expectHeightMax: number | null;
  expectBirthYearMin: number | null;
  expectBirthYearMax: number | null;
  expectEducation: string | null;
  expectCity: string | null;
  photoObjectKeys: string[];
  consentStatus: string;
}

/** 属相由出生年份推算（2020 鼠年基准） */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
function zodiac(birthYear: number) {
  return ZODIAC[((birthYear - 2020) % 12 + 12) % 12];
}

const p = ref<ProfileFull | null>(null);

onLoad(async (q) => {
  const id = (q as { profileId?: string })?.profileId;
  if (!id) return;
  p.value = await http.get<ProfileFull>(`/profiles/${id}`, { toast: false }).catch(() => null);
});

function goEdit() {
  if (!p.value) return;
  uni.navigateTo({ url: `/pages/profile/form/index?profileId=${p.value.id}` });
}

const housingText: Record<string, string> = { OWNED_FULL: '有房(全款)', OWNED_MORTGAGE: '有房(贷款)', NONE: '无房', UNDISCLOSED: '保密' };
const carText: Record<string, string> = { OWNED: '有车', NONE: '无车', UNDISCLOSED: '保密' };
const auditText: Record<string, string> = { DRAFT: '草稿（未发布）', PENDING: '审核中', APPROVED: '已通过，正常展示', REJECTED: '未通过，请修改后重新提交' };
</script>

<template>
  <view class="page">
    <text class="title">档案预览</text>
    <text v-if="p" class="sub">这就是其他亲家看到的您的档案（编号 {{ p.matchNo }} · {{ auditText[p.auditStatus] }}）</text>

    <view v-if="p" class="card">
      <view class="photos">
        <view v-for="(_, i) in p.photoObjectKeys" :key="i" class="ph">照片{{ i + 1 }}</view>
        <text v-if="!p.photoObjectKeys.length" class="no-ph">未上传照片</text>
      </view>
      <text class="name">{{ p.gender === 'MALE' ? '男生' : '女生' }} · {{ p.birthYear }}年{{ String(new Date().getFullYear() - p.birthYear) }}岁</text>
      <view class="facts">
        <view class="f"><text class="k">身高</text><text class="v">{{ p.heightCm }}cm</text></view>
        <view v-if="p.bodyType" class="f"><text class="k">体型</text><text class="v">{{ p.bodyType }}</text></view>
        <view class="f"><text class="k">属相</text><text class="v">{{ zodiac(p.birthYear) }}</text></view>
        <view class="f"><text class="k">学历</text><text class="v">{{ labelOf(EDUCATION_OPTIONS, p.education) }}</text></view>
        <view class="f"><text class="k">职业</text><text class="v">{{ p.occupation }}</text></view>
        <view class="f"><text class="k">月收入</text><text class="v">{{ labelOf(INCOME_OPTIONS, p.incomeRange) }}</text></view>
        <view class="f"><text class="k">婚姻状况</text><text class="v">{{ labelOf(MARITAL_OPTIONS, p.maritalStatus) }}{{ p.isMaritalVerified ? '（已核验）' : '（未核验）' }}</text></view>
        <view class="f"><text class="k">定居城市</text><text class="v">{{ p.residenceCity }}{{ p.residenceDistrict ? ' ' + p.residenceDistrict : '' }}</text></view>
        <view v-if="p.hometown" class="f"><text class="k">老家</text><text class="v">{{ p.hometown }}</text></view>
        <view v-if="p.hukou" class="f"><text class="k">户籍</text><text class="v">{{ p.hukou }}</text></view>
        <view v-if="p.housing" class="f"><text class="k">房产</text><text class="v">{{ housingText[p.housing] || p.housing }}</text></view>
        <view v-if="p.car" class="f"><text class="k">车辆</text><text class="v">{{ carText[p.car] || p.car }}</text></view>
      </view>
      <text v-if="p.intro" class="intro">{{ p.intro }}</text>
      <view v-if="p.expectHeightMin || p.expectHeightMax || p.expectBirthYearMin || p.expectBirthYearMax || p.expectEducation || p.expectCity" class="expect">
        <text class="e-title">择偶标准</text>
        <text v-if="p.expectHeightMin || p.expectHeightMax" class="e-item">身高要求：{{ p.expectHeightMin || '不限' }}cm - {{ p.expectHeightMax || '不限' }}cm</text>
        <text v-if="p.expectBirthYearMin || p.expectBirthYearMax" class="e-item">年份要求：{{ p.expectBirthYearMin || '不限' }}年 - {{ p.expectBirthYearMax || '不限' }}年</text>
        <text v-if="p.expectEducation" class="e-item">学历要求：{{ labelOf(EDUCATION_OPTIONS, p.expectEducation) }}及以上</text>
        <text v-if="p.expectCity" class="e-item">地区要求：{{ p.expectCity }}</text>
      </view>
      <text v-if="p.consentStatus === 'PENDING'" class="warn">子女授权待完成，授权通过后才能发布</text>
    </view>

    <text v-if="p" class="edit" @click="goEdit">编辑资料（修改后需重新审核）</text>
    <text v-else class="empty">未找到档案</text>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 28rpx; color: #555; }
.card { margin-top: 24rpx; padding: 28rpx; background: #fff; border-radius: 20rpx; }
.photos { display: flex; flex-wrap: wrap; margin-bottom: 16rpx; }
.ph { width: 160rpx; height: 160rpx; background: #f0f0f0; border-radius: 12rpx; margin: 0 16rpx 16rpx 0; display: flex; align-items: center; justify-content: center; font-size: 26rpx; color: #999; }
.no-ph { font-size: 28rpx; color: #999; }
.name { display: block; font-size: 40rpx; font-weight: bold; color: #222; }
.facts { margin-top: 20rpx; }
.f { display: flex; padding: 18rpx 0; border-bottom: 2rpx solid #f5f5f5; }
.f:last-child { border-bottom: none; }
.k { width: 200rpx; font-size: 32rpx; color: #888; }
.v { flex: 1; font-size: 32rpx; color: #222; font-weight: bold; }
.intro { display: block; margin-top: 20rpx; padding: 20rpx; background: #fafafa; border-radius: 12rpx; font-size: 32rpx; color: #444; line-height: 1.6; }
.warn { display: block; margin-top: 20rpx; padding: 16rpx 20rpx; background: #fff3e0; border-radius: 12rpx; font-size: 28rpx; color: #e65100; }
.expect { margin-top: 24rpx; padding: 24rpx; background: #f7f9ff; border-radius: 12rpx; }
.e-title { display: block; font-size: 34rpx; font-weight: bold; color: #1a3b7a; }
.e-item { display: block; margin-top: 10rpx; font-size: 30rpx; color: #33507e; }
.edit { display: block; margin-top: 32rpx; text-align: center; font-size: 32rpx; color: #1976f2; }
.empty { display: block; margin-top: 80rpx; text-align: center; font-size: 32rpx; color: #888; }
</style>
