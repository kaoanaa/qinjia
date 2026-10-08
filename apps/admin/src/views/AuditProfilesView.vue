<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, fmtTime } from '../api';

interface AuditProfile {
  id: string; matchNo: string; ownerNickname: string; ownerPhoneMasked: string | null;
  realnamePassed: boolean; relation: string; gender: string; birthYear: number; heightCm: number;
  education: string; occupation: string; residenceCity: string; intro: string | null;
  auditStatus: string; rejectReason: string | null; isMaritalVerified: boolean;
  maritalProofPending: boolean; hasMaritalProof: boolean; commitmentSigned: boolean; consentPending: boolean;
  updatedAt: string;
}

const status = ref('PENDING');
const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<AuditProfile[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: AuditProfile[] }>(`/audit/profiles?status=${status.value}&page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function reload(s?: string) {
  if (s) status.value = s;
  page.page = 1;
  void load();
}

/** 通过：婚姻证明选审（D5：有待审证明时须裁决 isMaritalVerified 绿标） */
async function approve(row: AuditProfile) {
  let maritalVerified: 'PASS' | 'FAIL' | undefined;
  if (row.maritalProofPending) {
    // D5 选审：确认=标记已核验绿标；取消=不核验放行；关闭(X)=放弃本次操作
    maritalVerified = await ElMessageBox.confirm(
      '该档案含婚姻证明待选审。「标记已核验」将授予绿标；「不核验放行」仍通过档案但不给绿标。',
      '婚姻证明选审',
      { confirmButtonText: '标记已核验', cancelButtonText: '不核验放行', distinguishCancelAndClose: true, type: 'warning' },
    )
      .then(() => 'PASS' as const)
      .catch((a: string) => (a === 'cancel' ? ('FAIL' as const) : null));
    if (maritalVerified === null) return;
  }
  await api.post(`/audit/profiles/${row.id}`, { decision: 'APPROVE', ...(maritalVerified ? { maritalVerified } : {}) });
  ElMessage.success('已通过审核');
  void load();
}

async function reject(row: AuditProfile) {
  const input = await ElMessageBox.prompt('请输入拒绝理由（将通知用户）', '驳回档案', {
    inputPlaceholder: '如：照片含水印/信息不实',
    inputValidator: (v) => (v && v.trim().length >= 2) || '理由至少 2 个字',
  }).catch(() => null);
  if (!input) return;
  const res = await api.post<{ refundedUnlocks: string[] }>(`/audit/profiles/${row.id}`, { decision: 'REJECT', reason: input.value.trim() });
  ElMessage.success(res.refundedUnlocks.length ? `已驳回，${res.refundedUnlocks.length} 笔解锁已返还` : '已驳回');
  void load();
}

const relationLabel: Record<string, string> = { FATHER: '父亲', MOTHER: '母亲', SELF: '本人' };
</script>

<template>
  <div>
    <div class="bar">
      <el-radio-group :model-value="status" @change="(v: any) => reload(v as string)">
        <el-radio-button value="PENDING">待审</el-radio-button>
        <el-radio-button value="APPROVED">已通过</el-radio-button>
        <el-radio-button value="REJECTED">已驳回</el-radio-button>
        <el-radio-button value="DRAFT">草稿</el-radio-button>
      </el-radio-group>
      <el-button :disabled="!auth.can('SUPER', 'REVIEWER')" @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="matchNo" label="编号" width="120" />
      <el-table-column label="发布人" width="150">
        <template #default="{ row }">{{ row.ownerNickname }}<br /><span class="sub">{{ row.ownerPhoneMasked }}</span></template>
      </el-table-column>
      <el-table-column label="当事人" width="200">
        <template #default="{ row }">
          {{ relationLabel[row.relation] }}·{{ row.gender === 'FEMALE' ? '女' : '男' }} {{ new Date().getFullYear() - row.birthYear }}岁
          <br /><span class="sub">{{ row.heightCm }}cm · {{ row.education }} · {{ row.residenceCity }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="intro" label="寄语" min-width="180" show-overflow-tooltip />
      <el-table-column label="合规" width="200">
        <template #default="{ row }">
          <el-tag size="small" :type="row.realnamePassed ? 'success' : 'info'">{{ row.realnamePassed ? '实名' : '未实名' }}</el-tag>
          <el-tag size="small" :type="row.commitmentSigned ? 'success' : 'danger'" class="tag">{{ row.commitmentSigned ? '承诺书' : '缺承诺书' }}</el-tag>
          <el-tag v-if="row.maritalProofPending" size="small" type="warning" class="tag">婚姻证明待审</el-tag>
          <el-tag v-else-if="row.isMaritalVerified" size="small" type="success" class="tag">婚况已核验</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="160"><template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template></el-table-column>
      <el-table-column v-if="status === 'PENDING' && auth.can('SUPER', 'REVIEWER')" label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="success" @click="approve(row)">通过</el-button>
          <el-button link type="danger" @click="reject(row)">驳回</el-button>
        </template>
      </el-table-column>
      <el-table-column v-else-if="status === 'REJECTED'" prop="rejectReason" label="驳回理由" width="180" />
    </el-table>
    <el-pagination
      class="pager" layout="total, prev, pager, next" :total="page.total"
      :page-size="page.size" :current-page="page.page"
      @current-change="(p: number) => { page.page = p; load(); }"
    />
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; margin-bottom: 14px; }
.sub { color: #999; font-size: 12px; }
.tag { margin-left: 4px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
