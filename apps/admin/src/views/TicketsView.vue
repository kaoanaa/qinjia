<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtMsLeft, fmtTime } from '../api';

interface Ticket {
  id: string; userId: string; userNickname: string; type: string; content: string;
  status: string; slaDeadline: string; slaRemainingMs: number; handlerNote: string | null; createdAt: string;
}

const status = ref('OPEN');
const rows = ref<Ticket[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get<Ticket[]>(`/tickets?status=${encodeURIComponent(status.value)}`);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function reload(s: string) {
  status.value = s;
  void load();
}

async function toProcessing(row: Ticket) {
  await api.put(`/tickets/${row.id}`, { status: 'PROCESSING' });
  ElMessage.success('已标记处理中');
  void load();
}

async function close(row: Ticket) {
  const input = await ElMessageBox.prompt('填写处理结果（将作为系统消息回执给用户）', `结案工单 #${row.id}`, {
    inputType: 'textarea', inputPlaceholder: '如：已为您恢复额度，请查收', inputValidator: (v) => (v && v.trim().length >= 2) || '请至少 2 个字',
  }).catch(() => null);
  if (!input) return;
  await api.put(`/tickets/${row.id}`, { status: 'CLOSED', handlerNote: input.value.trim() });
  ElMessage.success('已结案并回执用户');
  void load();
}

const typeLabel: Record<string, string> = { FEEDBACK: '反馈', COMPLAINT: '投诉', REPORT: '举报', REFUND: '退款' };
const typeTag: Record<string, string> = { FEEDBACK: 'info', COMPLAINT: 'warning', REPORT: 'danger', REFUND: 'warning' };
</script>

<template>
  <div>
    <div class="bar">
      <el-radio-group :model-value="status" @change="(v: any) => reload(v as string)">
        <el-radio-button value="OPEN">待处理</el-radio-button>
        <el-radio-button value="PROCESSING">处理中</el-radio-button>
        <el-radio-button value="CLOSED">已结案</el-radio-button>
        <el-radio-button value="">全部</el-radio-button>
      </el-radio-group>
      <span class="tip">按首响 SLA（读配置 ticket_sla）升序，超时标红。</span>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="类型" width="90"><template #default="{ row }"><el-tag size="small" :type="(typeTag[row.type] ?? 'info') as any">{{ typeLabel[row.type] ?? row.type }}</el-tag></template></el-table-column>
      <el-table-column label="提交人" width="140"><template #default="{ row }">{{ row.userNickname }}<br /><span class="sub">#{{ row.userId }}</span></template></el-table-column>
      <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip />
      <el-table-column label="SLA" width="150">
        <template #default="{ row }">
          <span v-if="row.status === 'CLOSED'" class="sub">已结案</span>
          <span v-else :class="{ over: row.slaRemainingMs < 0 }">{{ fmtMsLeft(row.slaRemainingMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="handlerNote" label="处理备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="提交时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'OPEN'" link type="primary" @click="toProcessing(row)">受理</el-button>
          <el-button v-if="row.status !== 'CLOSED'" link type="success" @click="close(row)">结案</el-button>
          <span v-else class="sub">-</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.tip { color: #909399; font-size: 13px; }
.sub { color: #999; font-size: 12px; }
.over { color: #f56c6c; font-weight: bold; }
</style>
