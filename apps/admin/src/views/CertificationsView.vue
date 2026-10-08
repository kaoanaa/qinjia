<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, fmtTime } from '../api';

interface Cert { id: string; userId: string; nickname: string; phoneMasked: string | null; provider: string; createdAt: string }

const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<Cert[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: Cert[] }>(`/audit/certifications?page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function revoke(row: Cert) {
  const input = await ElMessageBox.prompt(`撤销 ${row.nickname} 的实名？将清空证件哈希占用并冻结其 active 额度`, '实名复核不通过', {
    inputPlaceholder: '理由（如人证不符）', type: 'warning',
  }).catch(() => null);
  if (!input) return;
  await api.post(`/audit/certifications/${row.id}`, { decision: 'REVOKE', reason: input.value.trim() });
  ElMessage.success('已撤销实名并冻结额度');
  void load();
}
</script>

<template>
  <div>
    <div class="tip">实名复核抽查队列（人脸通过记录）。复核不通过将撤销实名、冻结相关权益并通知用户。</div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="核身ID" width="90" />
      <el-table-column prop="userId" label="用户ID" width="110" />
      <el-table-column prop="nickname" label="昵称" width="150" />
      <el-table-column prop="phoneMasked" label="手机" width="150" />
      <el-table-column prop="provider" label="渠道" width="120" />
      <el-table-column label="通过时间" width="180"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column v-if="auth.can('SUPER', 'REVIEWER')" label="操作" width="120" fixed="right">
        <template #default="{ row }"><el-button link type="danger" @click="revoke(row)">复核不通过</el-button></template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />
  </div>
</template>

<style scoped>
.tip { color: #909399; font-size: 13px; margin-bottom: 12px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
