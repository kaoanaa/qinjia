<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, fmtTime } from '../api';

interface RiskEvent { id: string; userId: string; category: string; code: number; detail: unknown; createdAt: string }

const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<RiskEvent[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: RiskEvent[] }>(`/im/risk-events?page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const catLabel: Record<string, string> = { CONTACT: '解锁前泄露联系方式', SENSITIVE: '敏感词' };
</script>

<template>
  <div>
    <div class="tip">IM 风控台：服务端回调拦截的违规尝试留痕（解锁前明文联系方式 / 敏感词）。仅摘要，不含消息原文之外的敏感明文（I5）。</div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="userId" label="触发用户" width="120" />
      <el-table-column label="类别" width="200"><template #default="{ row }"><el-tag size="small" :type="row.category === 'CONTACT' ? 'danger' : 'warning'" class="tag">{{ catLabel[row.category] ?? row.category }}</el-tag></template></el-table-column>
      <el-table-column prop="code" label="错误码" width="90" />
      <el-table-column label="摘要" min-width="260"><template #default="{ row }"><code class="d">{{ JSON.stringify(row.detail) }}</code></template></el-table-column>
      <el-table-column label="时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />
  </div>
</template>

<style scoped>
.tip { color: #909399; font-size: 13px; margin-bottom: 12px; }
.tag { font-weight: normal; }
.d { font-size: 12px; word-break: break-all; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
