<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, fmtTime } from '../api';

interface Batch { id: string; userId: string; source: string; total: number; remaining: number; status: string; expireAt: string; createdAt: string }
interface TxLog { id: string; quotaId: string | null; userId: string; reason: string; change: number; refType: string | null; refId: string | null; createdAt: string }

const userId = ref('');
const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<Batch[]>([]);
const logs = ref<TxLog[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: Batch[]; logs: TxLog[] }>(`/quotas?userId=${encodeURIComponent(userId.value)}&page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    logs.value = res.logs;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function search() {
  page.page = 1;
  void load();
}

const sourceLabel: Record<string, string> = { NEWBIE: '新手礼', INVITE: '邀请', PAID: '付费' };
const reasonLabel: Record<string, string> = { GRANT: '发放', DEDUCT: '扣减', REFUND: '返还', EXPIRE: '过期', ZERO_OUT: '到期清零' };
</script>

<template>
  <div>
    <div class="bar">
      <el-input v-model="userId" placeholder="按 userId 过滤（留空看全量批次）" clearable class="kw" @keyup.enter="search" @clear="search" />
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="批次ID" width="90" />
      <el-table-column prop="userId" label="用户ID" width="100" />
      <el-table-column label="来源" width="100"><template #default="{ row }">{{ sourceLabel[row.source] ?? row.source }}</template></el-table-column>
      <el-table-column prop="total" label="总额度" width="90" />
      <el-table-column prop="remaining" label="剩余" width="90" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="到期" width="170"><template #default="{ row }">{{ fmtTime(row.expireAt) }}</template></el-table-column>
      <el-table-column label="发放时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />

    <el-divider>最近流水（本页批次，最多 200 条）</el-divider>
    <el-table :data="logs" border max-height="360">
      <el-table-column prop="id" label="流水ID" width="90" />
      <el-table-column prop="userId" label="用户ID" width="100" />
      <el-table-column label="动作" width="100"><template #default="{ row }"><el-tag size="small" :type="row.change < 0 ? 'danger' : 'success'">{{ reasonLabel[row.reason] ?? row.reason }} {{ row.change }}</el-tag></template></el-table-column>
      <el-table-column prop="refType" label="关联" width="110" />
      <el-table-column prop="refId" label="关联ID" width="110" />
      <el-table-column label="时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.bar { margin-bottom: 14px; }
.kw { width: 320px; margin-right: 10px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
