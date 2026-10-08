<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, auth, yuan } from '../api';

interface Funnel {
  register: number; realnamePassed: number; unlocks: number;
  paidOrders: number; paidAmountCent: number; refunds: number; invitedRewarded: number;
}

const days = ref(30);
const data = ref<Funnel | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - days.value * 864e5);
    data.value = await api.get<Funnel>(`/dashboard/funnel?from=${from.toISOString()}&to=${to.toISOString()}`);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const cards = computed(() => {
  const f = data.value;
  if (!f) return [];
  return [
    { label: '注册用户', value: f.register, sub: '区间内新增' },
    { label: '实名通过', value: f.realnamePassed, sub: `转化率 ${pct(f.realnamePassed, f.register)}` },
    { label: '解锁次数', value: f.unlocks, sub: '含额度/单次/券' },
    { label: '付费订单', value: f.paidOrders, sub: `GMV ${yuan(f.paidAmountCent)}` },
    { label: '退款单', value: f.refunds, sub: '窗口内退款' },
    { label: '邀请发奖', value: f.invitedRewarded, sub: '已到账' },
  ];
});
function pct(a: number, b: number) {
  return b === 0 ? '-' : `${((a / b) * 100).toFixed(1)}%`;
}

// 支付对账（§6.6）：手动触发日切
interface Recon {
  date: string; localCount: number;
  missingInBill: string[]; missingInSystem: string[]; amountMismatch: string[];
}
const reconDate = ref('');
const recon = ref<Recon | null>(null);
const reconDiff = computed(() => (recon.value ? recon.value.missingInBill.length + recon.value.missingInSystem.length + recon.value.amountMismatch.length : 0));
const reconBusy = ref(false);
async function runRecon() {
  reconBusy.value = true;
  try {
    recon.value = await api.post(`/reconciliation/run${reconDate.value ? `?date=${reconDate.value}` : ''}`);
    ElMessage.success('对账完成');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    reconBusy.value = false;
  }
}
</script>

<template>
  <div v-loading="loading">
    <div class="bar">
      <el-radio-group v-model="days" @change="load">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
      </el-radio-group>
      <div v-if="auth.can('SUPER')" class="recon">
        <el-date-picker v-model="reconDate" type="date" value-format="YYYY-MM-DD" placeholder="对账日期(默认昨日)" clearable class="dp" />
        <el-button :loading="reconBusy" @click="runRecon">运行支付对账</el-button>
      </div>
    </div>

    <el-row :gutter="16" class="funnel">
      <el-col v-for="c in cards" :key="c.label" :span="8">
        <div class="stat">
          <div class="num">{{ c.value }}</div>
          <div class="lbl">{{ c.label }}</div>
          <div class="sub">{{ c.sub }}</div>
        </div>
      </el-col>
    </el-row>

    <el-card v-if="recon" class="recon-card" shadow="never">
      <template #header>对账结果 · {{ recon.date }}</template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="本地订单数">{{ recon.localCount }}</el-descriptions-item>
        <el-descriptions-item label="差异总数">
          <span :class="{ diff: reconDiff !== 0 }">{{ reconDiff }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="本地有·账单无">{{ recon.missingInBill.join('、') || '无' }}</el-descriptions-item>
        <el-descriptions-item label="账单有·本地无">{{ recon.missingInSystem.join('、') || '无' }}</el-descriptions-item>
        <el-descriptions-item label="金额不符" :span="2">{{ recon.amountMismatch.join('、') || '无' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.recon { display: flex; gap: 10px; align-items: center; }
.dp { width: 200px; }
.funnel .stat { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06); }
.num { font-size: 32px; font-weight: bold; color: #1f2d3d; }
.lbl { font-size: 15px; color: #333; margin-top: 6px; }
.sub { font-size: 12px; color: #909399; margin-top: 2px; }
.recon-card { margin-top: 8px; }
.diff { color: #f56c6c; font-weight: bold; }
</style>
