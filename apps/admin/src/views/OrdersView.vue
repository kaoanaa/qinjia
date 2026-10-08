<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, fmtTime, yuan } from '../api';

interface Order {
  id: string; userId: string; type: string; bizRef: string | null; amountCent: number;
  couponDeductCent: number; outTradeNo: string; payStatus: string; refundStatus: string;
  refundAmountCent: number | null; paidAt: string | null; createdAt: string;
}
interface RefundResult { refundAmountCent: number | null; calcDetail: unknown; quotaReturned: boolean; refundStatus: string; rule: unknown }

const payStatus = ref('');
const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<Order[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: Order[] }>(`/orders?payStatus=${encodeURIComponent(payStatus.value)}&page=${page.page}&size=${page.size}`);
    rows.value = res.items;
    page.total = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function reload(s?: string) {
  if (s !== undefined) payStatus.value = s;
  page.page = 1;
  void load();
}

/** 退款裁决（§6.5/D7）：核准=原路退回+反履约；驳回=REJECTED。公式试算明细透传给财务核对 */
async function refund(row: Order, approved: boolean) {
  let reason = '';
  if (approved) {
    const input = await ElMessageBox.prompt(`确认退款 ${yuan(row.amountCent - row.couponDeductCent)}？将按退款公式原路退回并回收权益`, '退款核准', {
      inputPlaceholder: '退款备注（可选）', type: 'warning', inputValue: '',
    }).catch(() => null);
    if (!input) return;
    reason = input.value.trim();
  } else if (!(await ElMessageBox.confirm('驳回该退款申请？', '退款驳回', { type: 'warning' }).catch(() => false))) return;

  const res = await api.post<RefundResult>(`/orders/${row.id}/refund`, { approved, ...(reason ? { reason } : {}) });
  const detail = JSON.stringify(res.calcDetail);
  ElMessage({ type: 'success', message: `已${approved ? '核准退款' : '驳回'}：${approved ? yuan(res.refundAmountCent) : res.refundStatus}（试算 ${detail}）`, duration: 6000 });
  void load();
}

const payLabel: Record<string, { t: string; type: string }> = {
  CREATED: { t: '待支付', type: 'info' }, PAID: { t: '已支付', type: 'success' }, CLOSED: { t: '已关闭', type: 'info' },
};
const refundLabel: Record<string, string> = { NONE: '-', REQUESTED: '待裁决', REFUNDING: '退款中', REFUNDED: '已退款', REJECTED: '已驳回' };
</script>

<template>
  <div>
    <div class="bar">
      <el-radio-group :model-value="payStatus" @change="(v: any) => reload(v as string)">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="PAID">已支付</el-radio-button>
        <el-radio-button value="CREATED">待支付</el-radio-button>
        <el-radio-button value="CLOSED">已关闭</el-radio-button>
      </el-radio-group>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="订单ID" width="90" />
      <el-table-column prop="userId" label="用户" width="90" />
      <el-table-column label="类型" width="120"><template #default="{ row }">{{ row.type === 'MEMBER' ? '会员' : '单次解锁' }}</template></el-table-column>
      <el-table-column label="金额" width="100"><template #default="{ row }">{{ yuan(row.amountCent) }}</template></el-table-column>
      <el-table-column label="券抵扣" width="90"><template #default="{ row }">{{ yuan(row.couponDeductCent) }}</template></el-table-column>
      <el-table-column label="支付" width="90"><template #default="{ row }"><el-tag size="small" :type="(payLabel[row.payStatus]?.type as any)">{{ payLabel[row.payStatus]?.t }}</el-tag></template></el-table-column>
      <el-table-column label="退款" width="90"><template #default="{ row }">{{ refundLabel[row.refundStatus] }}</template></el-table-column>
      <el-table-column prop="outTradeNo" label="商户单号" min-width="200" show-overflow-tooltip />
      <el-table-column label="支付时间" width="170"><template #default="{ row }">{{ fmtTime(row.paidAt) }}</template></el-table-column>
      <el-table-column v-if="auth.can('SUPER', 'FINANCE')" label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <template v-if="row.refundStatus === 'REQUESTED'">
            <el-button link type="danger" @click="refund(row, true)">核准</el-button>
            <el-button link @click="refund(row, false)">驳回</el-button>
          </template>
          <span v-else class="sub">-</span>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />
  </div>
</template>

<style scoped>
.bar { margin-bottom: 14px; }
.sub { color: #ccc; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
