<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, auth, fmtTime } from '../api';

interface Slot { id: string; type: string; content: Record<string, unknown>; startAt: string; endAt: string; sort: number; enabled: boolean }

const rows = ref<Slot[]>([]);
const loading = ref(false);
const editable = computed(() => auth.can('SUPER', 'OPERATOR'));

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get<Slot[]>('/ops-slots');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const dialog = ref(false);
const form = reactive<{ id: string; type: string; content: string; range: [string, string] | null; sort: number; enabled: boolean }>({
  id: '', type: 'BANNER', content: '{}', range: null, sort: 0, enabled: true,
});

function openCreate() {
  Object.assign(form, { id: '', type: 'BANNER', content: '{"title":"","text":"","linkPage":""}', range: null, sort: 0, enabled: true });
  dialog.value = true;
}
function openEdit(s: Slot) {
  Object.assign(form, {
    id: s.id, type: s.type, content: JSON.stringify(s.content, null, 2),
    range: [s.startAt, s.endAt] as [string, string], sort: s.sort, enabled: s.enabled,
  });
  dialog.value = true;
}

async function save() {
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(form.content);
  } catch {
    ElMessage.error('content 需为合法 JSON');
    return;
  }
  if (!form.range) {
    ElMessage.error('请选择起止时间');
    return;
  }
  try {
    await api.post('/ops-slots', {
      ...(form.id ? { id: form.id } : {}), type: form.type, content,
      startAt: form.range[0], endAt: form.range[1], sort: form.sort, enabled: form.enabled ? 'true' : 'false',
    });
    ElMessage.success('已保存');
    dialog.value = false;
    void load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

const typeLabel: Record<string, string> = { BANNER: '横幅/指南', POPUP: '弹窗', TAB_CENTER: '中部Tab' };
</script>

<template>
  <div>
    <div class="bar">
      <span class="tip">运营位内容本身即配置（红线 I1）。小程序按 startAt~endAt 且 enabled 的窗口拉取。</span>
      <el-button v-if="editable" type="primary" @click="openCreate">新增运营位</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="类型" width="120"><template #default="{ row }">{{ typeLabel[row.type] ?? row.type }}</template></el-table-column>
      <el-table-column label="内容" min-width="260"><template #default="{ row }"><code class="c">{{ JSON.stringify(row.content) }}</code></template></el-table-column>
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="起" width="170"><template #default="{ row }">{{ fmtTime(row.startAt) }}</template></el-table-column>
      <el-table-column label="止" width="170"><template #default="{ row }">{{ fmtTime(row.endAt) }}</template></el-table-column>
      <el-table-column label="启用" width="80"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '是' : '否' }}</el-tag></template></el-table-column>
      <el-table-column v-if="editable" label="操作" width="90" fixed="right">
        <template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button></template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="form.id ? '编辑运营位' : '新增运营位'" width="600px">
      <el-form label-width="90px">
        <el-form-item label="类型">
          <el-select v-model="form.type"><el-option label="横幅/指南" value="BANNER" /><el-option label="弹窗" value="POPUP" /><el-option label="中部Tab" value="TAB_CENTER" /></el-select>
        </el-form-item>
        <el-form-item label="起止时间">
          <el-date-picker v-model="form.range" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ssZ" start-placeholder="开始" end-placeholder="结束" />
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item label="内容 JSON"><el-input v-model="form.content" type="textarea" :rows="6" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.tip { color: #909399; font-size: 13px; }
.c { font-size: 12px; word-break: break-all; }
</style>
