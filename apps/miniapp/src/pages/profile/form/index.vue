<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { http } from '@/api/http';
import { EDUCATION_OPTIONS, INCOME_OPTIONS, MARITAL_OPTIONS } from '@/api/options';

// 建档表单（PRD §5.2/§5.9 字段）→ POST /profiles 存草稿，下一步进承诺书发布
// 带 ?profileId 时为编辑模式：回填 + PUT（修改后服务端重置 PENDING 重审）
const relation = uni.getStorageSync('qj_relation') || 'MOTHER';
const editId = ref('');
const relationLabel: Record<string, string> = { FATHER: '孩子', MOTHER: '孩子', SELF: '本人' };

const form = reactive({
  gender: 'FEMALE',
  birthYear: '1995',
  heightCm: '165',
  education: 'BACHELOR',
  occupation: '',
  incomeRange: 'UNDISCLOSED',
  maritalStatus: 'UNMARRIED',
  residenceCity: '杭州',
  residenceDistrict: '',
  intro: '',
});
const photoKeys = ref<string[]>([]);
const submitting = ref(false);

onLoad(async (q) => {
  const id = (q as { profileId?: string })?.profileId;
  if (!id) return;
  editId.value = id;
  const p = await http.get<Record<string, unknown>>(`/profiles/${id}`).catch(() => null);
  if (!p) return;
  form.gender = String(p.gender);
  form.birthYear = String(p.birthYear);
  form.heightCm = String(p.heightCm);
  form.education = String(p.education);
  form.occupation = String(p.occupation ?? '');
  form.incomeRange = String(p.incomeRange ?? 'UNDISCLOSED');
  form.maritalStatus = String(p.maritalStatus ?? 'UNMARRIED');
  form.residenceCity = String(p.residenceCity ?? '');
  form.residenceDistrict = String(p.residenceDistrict ?? '');
  form.intro = String(p.intro ?? '');
  photoKeys.value = (p.photoObjectKeys as string[]) ?? [];
});

const eduLabels = computed(() => EDUCATION_OPTIONS.map((o) => o.label));
const incomeLabels = computed(() => INCOME_OPTIONS.map((o) => o.label));
const maritalLabels = computed(() => MARITAL_OPTIONS.map((o) => o.label));
const eduIndex = computed(() => Math.max(0, EDUCATION_OPTIONS.findIndex((o) => o.value === form.education)));
const incomeIndex = computed(() => Math.max(0, INCOME_OPTIONS.findIndex((o) => o.value === form.incomeRange)));
const maritalIndex = computed(() => Math.max(0, MARITAL_OPTIONS.findIndex((o) => o.value === form.maritalStatus)));

/** 模拟直传：向后端申请 objectKey（mock OSS，真实流程再 PUT uploadUrl） */
async function addPhoto() {
  if (photoKeys.value.length >= 9) {
    uni.showToast({ title: '最多 9 张照片', icon: 'none' });
    return;
  }
  const res = await http.post<{ objectKey: string }>('/media/upload-token', { bucket: 'photos', mime: 'image/jpeg' });
  photoKeys.value.push(res.objectKey);
}

async function submit() {
  if (!form.occupation.trim()) {
    uni.showToast({ title: '请填写职业', icon: 'none' });
    return;
  }
  if (!form.residenceCity.trim()) {
    uni.showToast({ title: '请填写居住城市', icon: 'none' });
    return;
  }
  if (photoKeys.value.length === 0) {
    uni.showToast({ title: '请至少添加 1 张照片', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      relation,
      gender: form.gender,
      birthYear: Number(form.birthYear),
      heightCm: Number(form.heightCm),
      education: form.education,
      occupation: form.occupation.trim(),
      incomeRange: form.incomeRange,
      maritalStatus: form.maritalStatus,
      residenceCity: form.residenceCity.trim(),
      residenceDistrict: form.residenceDistrict.trim() || undefined,
      intro: form.intro.trim() || undefined,
      photoObjectKeys: photoKeys.value,
    };
    if (editId.value) {
      await http.put(`/profiles/${editId.value}`, payload);
      uni.showModal({
        title: '已保存',
        content: '资料修改后需要重新审核，通过后自动恢复展示',
        showCancel: false,
        success: () => uni.navigateBack(),
      });
      return;
    }
    const p = await http.post<{ id: string }>('/profiles', payload);
    uni.setStorageSync('qj_profile_id', p.id);
    uni.navigateTo({ url: '/pages/profile/commitment/index' });
  } catch {
    /* toast 已统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <text class="title">填写{{ relationLabel[relation] }}资料</text>
    <text class="sub">资料真实完整，匹配更精准</text>

    <view class="row">
      <text class="label">性别</text>
      <view class="seg">
        <text :class="{ on: form.gender === 'MALE' }" @click="form.gender = 'MALE'">男</text>
        <text :class="{ on: form.gender === 'FEMALE' }" @click="form.gender = 'FEMALE'">女</text>
      </view>
    </view>

    <view class="row">
      <text class="label">出生年份</text>
      <input v-model="form.birthYear" class="input" type="number" placeholder="如 1995" />
    </view>

    <view class="row">
      <text class="label">身高（厘米）</text>
      <input v-model="form.heightCm" class="input" type="number" placeholder="如 165" />
    </view>

    <view class="row">
      <text class="label">学历</text>
      <picker :range="eduLabels" :value="eduIndex" @change="(e: any) => (form.education = EDUCATION_OPTIONS[e.detail.value].value)">
        <view class="picker">{{ eduLabels[eduIndex] }}</view>
      </picker>
    </view>

    <view class="row">
      <text class="label">职业</text>
      <input v-model="form.occupation" class="input" placeholder="如 教师" maxlength="40" />
    </view>

    <view class="row">
      <text class="label">月收入</text>
      <picker :range="incomeLabels" :value="incomeIndex" @change="(e: any) => (form.incomeRange = INCOME_OPTIONS[e.detail.value].value)">
        <view class="picker">{{ incomeLabels[incomeIndex] }}</view>
      </picker>
    </view>

    <view class="row">
      <text class="label">婚姻状况</text>
      <picker :range="maritalLabels" :value="maritalIndex" @change="(e: any) => (form.maritalStatus = MARITAL_OPTIONS[e.detail.value].value)">
        <view class="picker">{{ maritalLabels[maritalIndex] }}</view>
      </picker>
    </view>

    <view class="row">
      <text class="label">居住城市</text>
      <input v-model="form.residenceCity" class="input" placeholder="如 杭州" maxlength="30" />
    </view>

    <view class="row">
      <text class="label">区县（选填）</text>
      <input v-model="form.residenceDistrict" class="input" placeholder="如 西湖区" maxlength="30" />
    </view>

    <view class="col">
      <text class="label">家长寄语（选填）</text>
      <textarea v-model="form.intro" class="textarea" placeholder="介绍一下孩子的性格、期待的另一半" maxlength="500" />
    </view>

    <view class="col">
      <text class="label">照片（至少 1 张）</text>
      <view class="photos">
        <view v-for="(k, i) in photoKeys" :key="k" class="photo-chip">照{{ i + 1 }}</view>
        <view class="photo-add" @click="addPhoto">＋ 添加照片</view>
      </view>
    </view>

    <button class="big-btn" :loading="submitting" @click="submit">{{ editId ? '保存修改（需重新审核）' : '下一步：签署承诺书' }}</button>
  </view>
</template>

<style lang="scss" scoped>
.page { padding: 48rpx 32rpx 64rpx; }
.title { display: block; font-size: 48rpx; font-weight: bold; color: #222; }
.sub { display: block; margin-top: 16rpx; font-size: 32rpx; color: #555; }
.row { display: flex; align-items: center; margin-top: 32rpx; }
.col { margin-top: 32rpx; }
.label { width: 220rpx; font-size: 34rpx; color: #333; }
.input { flex: 1; height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; }
.picker { flex: 1; height: 88rpx; line-height: 88rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 0 24rpx; font-size: 34rpx; background: #fff; color: #222; }
.seg { flex: 1; display: flex; }
.seg text { flex: 1; text-align: center; padding: 24rpx 0; font-size: 36rpx; border: 2rpx solid #ddd; color: #555; background: #fff; }
.seg text:first-child { border-radius: 16rpx 0 0 16rpx; }
.seg text:last-child { border-radius: 0 16rpx 16rpx 0; }
.seg text.on { background: #e64340; color: #fff; border-color: #e64340; }
.textarea { width: 100%; min-height: 160rpx; border: 2rpx solid #ddd; border-radius: 16rpx; padding: 24rpx; font-size: 34rpx; background: #fff; box-sizing: border-box; }
.photos { display: flex; flex-wrap: wrap; margin-top: 16rpx; }
.photo-chip { padding: 20rpx 28rpx; background: #ffe9e8; color: #e64340; border-radius: 12rpx; margin: 0 16rpx 16rpx 0; font-size: 32rpx; }
.photo-add { padding: 20rpx 28rpx; border: 2rpx dashed #e64340; color: #e64340; border-radius: 12rpx; font-size: 32rpx; }
.big-btn { margin-top: 48rpx; height: 104rpx; line-height: 104rpx; background: #e64340; color: #fff; font-size: 40rpx; border-radius: 52rpx; }
</style>
