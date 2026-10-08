<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, fmtTime } from '../api';

interface Lead {
  id: string; userId: string; nickname: string; phoneMasked: string | null; city: string;
  expectation: string; budgetCent: number | null; status: string; managerUsername: string | null;
  convId: string | null; createdAt: string;
}

const status = ref('NEW');
const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<Lead[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: Lead[] }>(`/manager-leads?status=${encodeURIComponent(status.value)}&page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function reload(s?: string) {
  if (s !== undefined) status.value = s;
  page.page = 1;
  void load();
}

/** 派单：填管家（后台启用账号）userId，服务端复用 IM 加好友 + 发欢迎语（话术读配置） */
async function assign(row: Lead) {
  const input = await ElMessageBox.prompt(`为「${row.nickname}」派单：输入管家账号的 userId（须为已启用的后台账号）`, '派单', {
    inputPattern: /^\d{1,19}$/, inputErrorMessage: '请输入数字 userId',
  }).catch(() => null);
  if (!input) return;
  const res = await api.post<{ status: string; convId: string }>(`/manager-leads/${row.id}/assign`, { managerId: input.value.trim() });
  ElMessage.success(`已派单，会话 ${res.convId}`);
  void load();
}

async function setStatus(row: Lead, s: string) {
  await api.put(`/manager-leads/${row.id}/status`, { status: s });
  ElMessage.success(s === 'DONE' ? '已结案' : '已标记跟进中');
  void load();
}

const statusTag: Record<string, string> = { NEW: 'danger', ASSIGNED: 'warning', FOLLOWING: 'primary', DONE: 'success' };
const statusLabel: Record<string, string> = { NEW: '新留资', ASSIGNED: '已派单', FOLLOWING: '跟进中', DONE: '已结案' };
</script>

<template>
  <div>
    <div class="bar">
      <el-radio-group :model-value="status" @change="(v: any) => reload(v as string)">
        <el-radio-button value="NEW">新留资</el-radio-button>
        <el-radio-button value="ASSIGNED">已派单</el-radio-button>
        <el-radio-button value="FOLLOWING">跟进中</el-radio-button>
        <el-radio-button value="DONE">已结案</el-radio-button>
        <el-radio-button value="">全部</el-radio-button>
      </el-radio-group>
      <span class="tip">加速脱单 1v1 留资派单（D6）。</span>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="用户" width="150"><template #default="{ row }">{{ row.nickname }}<br /><span class="sub">{{ row.phoneMasked }}</span></template></el-table-column>
      <el-table-column prop="city" label="城市" width="90" />
      <el-table-column prop="expectation" label="诉求" min-width="220" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="(statusTag[row.status] ?? 'info') as any">{{ statusLabel[row.status] ?? row.status }}</el-tag></template></el-table-column>
      <el-table-column prop="managerUsername" label="管家" width="120"><template #default="{ row }">{{ row.managerUsername ?? '-' }}</template></el-table-column>
      <el-table-column label="留资时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column v-if="auth.can('SUPER', 'OPERATOR')" label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'NEW'" link type="primary" @click="assign(row)">派单</el-button>
          <el-button v-else-if="row.status === 'ASSIGNED'" link type="warning" @click="setStatus(row, 'FOLLOWING')">跟进</el-button>
          <el-button v-else-if="row.status === 'FOLLOWING'" link type="success" @click="setStatus(row, 'DONE')">结案</el-button>
          <span v-else class="sub">已结案</span>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.tip { color: #909399; font-size: 13px; }
.sub { color: #999; font-size: 12px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
