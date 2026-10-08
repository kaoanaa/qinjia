<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, auth, fmtTime } from '../api';

interface ConfigRow { configKey: string; value: unknown; updatedAt: string }

/** PRD §11 全清单（与 @qinjia/shared ConfigKeys 一一对应）。中文名仅展示映射，值一律来自接口（红线 I1） */
const CONFIG_META: { group: string; items: { key: string; label: string; unit?: string }[] }[] = [
  {
    group: '定价与额度',
    items: [
      { key: 'unlock_once_price', label: '单次解锁价', unit: '分' },
      { key: 'unlock_validity', label: '解锁有效期', unit: '天' },
      { key: 'paid_member_plan', label: '付费会员套餐' },
      { key: 'newbie_reward', label: '新手奖励额度' },
      { key: 'invite_reward', label: '邀请奖励' },
    ],
  },
  {
    group: '推荐算法',
    items: [
      { key: 'age_window', label: '年龄窗（±岁）' },
      { key: 'random_ratio', label: '随机坑位比' },
      { key: 'rotation_ratio', label: '轮换比' },
      { key: 'feed_weights', label: 'feed 各项权重' },
    ],
  },
  {
    group: '话术与提醒',
    items: [
      { key: 'copywriting', label: '话术文案与开关' },
      { key: 'remind_nodes', label: '提醒节点', unit: '天' },
      { key: 'big_pay_threshold', label: '大额支付阈值', unit: '分' },
    ],
  },
  {
    group: '运营与集成',
    items: [
      { key: 'coupon_templates', label: '优惠券模板' },
      { key: 'ops_slots', label: '运营位内容' },
      { key: 'im_config', label: 'IM 通道与风控' },
      { key: 'ticket_sla', label: '工单首响 SLA', unit: '小时' },
    ],
  },
  {
    group: '风控与合规',
    items: [
      { key: 'rate_limit', label: '解锁限频参数' },
      { key: 'account_close', label: '注销冷静期', unit: '天' },
      { key: 'refund_rules', label: '退款规则窗口' },
    ],
  },
];

const rows = ref<ConfigRow[]>([]);
const loading = ref(false);
const editable = computed(() => auth.can('SUPER'));

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get<ConfigRow[]>('/config');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const byKey = computed(() => {
  const m = new Map<string, ConfigRow>();
  for (const r of rows.value) m.set(r.configKey, r);
  return m;
});

// 编辑弹窗
const dialog = ref(false);
const editing = ref<{ key: string; label: string; text: string; updatedAt: string } | null>(null);

function openEdit(key: string, label: string) {
  const row = byKey.value.get(key);
  if (!row) {
    ElMessage.info('该项尚未初始化，seed 后出现');
    return;
  }
  editing.value = { key, label, text: JSON.stringify(row.value, null, 2), updatedAt: row.updatedAt };
  dialog.value = true;
}

async function save() {
  if (!editing.value) return;
  let value: unknown;
  try {
    value = JSON.parse(editing.value.text);
  } catch {
    ElMessage.error('JSON 格式不合法，请检查');
    return;
  }
  try {
    await api.put(`/config/${editing.value.key}`, { value });
    ElMessage.success('已保存并实时生效（配置缓存已失效）');
    dialog.value = false;
    void load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
</script>

<template>
  <div v-loading="loading">
    <el-alert
      :closable="false" type="warning" class="banner"
      title="配置中心是全局唯一写入口（红线 I1）：所有金额/额度/时长/权重/话术均在此维护，保存即失效缓存、实时生效。仅超管可改。"
      :description="editable ? undefined : '当前角色只读，改配置请用超级管理员账号。'"
    />

    <div v-for="grp in CONFIG_META" :key="grp.group" class="section">
      <div class="grp-title">{{ grp.group }}</div>
      <el-table :data="grp.items" border :show-header="false">
        <el-table-column prop="label" width="200" />
        <el-table-column width="180">
          <template #default="{ row }"><code class="k">{{ row.key }}</code><span v-if="row.unit" class="unit">({{ row.unit }})</span></template>
        </el-table-column>
        <el-table-column>
          <template #default="{ row }">
            <code class="v">{{ byKey.get(row.key) ? JSON.stringify(byKey.get(row.key)!.value) : '—' }}</code>
          </template>
        </el-table-column>
        <el-table-column width="180">
          <template #default="{ row }">
            <span class="upd">{{ byKey.get(row.key) ? fmtTime(byKey.get(row.key)!.updatedAt) : '' }}</span>
            <el-button v-if="editable && byKey.get(row.key)" link type="primary" @click="openEdit(row.key, row.label)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="`编辑配置 · ${editing?.label}`" width="620px">
      <div class="edit-key">{{ editing?.key }}（最近更新：{{ fmtTime(editing?.updatedAt) }}）</div>
      <el-input v-model="editing!.text" type="textarea" :rows="16" class="json" />
      <div class="hint">请保持合法 JSON。金额字段单位为「分」，天数/小时按各 key 语义。</div>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存并生效</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.banner { margin-bottom: 18px; }
.section { margin-bottom: 22px; }
.grp-title { font-size: 15px; font-weight: bold; color: #1f2d3d; margin-bottom: 8px; padding-left: 8px; border-left: 3px solid #409eff; }
.k { color: #606266; font-size: 12px; }
.unit { color: #909399; font-size: 12px; margin-left: 4px; }
.v { color: #303133; font-size: 12px; word-break: break-all; display: inline-block; max-height: 44px; overflow: hidden; }
.upd { color: #909399; font-size: 12px; margin-right: 8px; }
.edit-key { color: #909399; font-size: 12px; margin-bottom: 8px; }
.json :deep(textarea) { font-family: 'SF Mono', Menlo, monospace; font-size: 13px; }
.hint { color: #e6a23c; font-size: 12px; margin-top: 8px; }
</style>
