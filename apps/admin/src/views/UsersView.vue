<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, fmtTime } from '../api';

interface User {
  id: string; nickname: string; phoneMasked: string | null; memberLevel: string;
  memberExpireAt: string | null; status: string; hasUnionid: boolean; hasDeviceFingerprint: boolean;
  hasIdCard: boolean; newbieRewardClaimed: boolean; createdAt: string;
}

const keyword = ref('');
const page = reactive({ page: 1, size: 20, total: 0 });
const rows = ref<User[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ total: number; items: User[] }>(`/users?keyword=${encodeURIComponent(keyword.value)}&page=${page.page}&size=${page.size}`);
    rows.value = res.items;
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

const memberLabel: Record<string, string> = { NONE: '普通', TRIAL: '体验会员', PAID: '付费会员', INTENTION: '意向墙' };
</script>

<template>
  <div>
    <div class="bar">
      <el-input v-model="keyword" placeholder="手机号 / 昵称 / userId 精确" clearable class="kw" @keyup.enter="search" @clear="search" />
      <el-button type="primary" @click="search">查询</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="id" label="ID" width="100" />
      <el-table-column prop="nickname" label="昵称" width="150" />
      <el-table-column prop="phoneMasked" label="手机" width="140" />
      <el-table-column label="会员" width="100"><template #default="{ row }">{{ memberLabel[row.memberLevel] ?? row.memberLevel }}</template></el-table-column>
      <el-table-column label="到期" width="170"><template #default="{ row }">{{ fmtTime(row.memberExpireAt) }}</template></el-table-column>
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="三唯一标识（防刷排查）" width="230">
        <template #default="{ row }">
          <el-tag size="small" :type="row.hasIdCard ? 'success' : 'info'" class="tag">{{ row.hasIdCard ? '证件' : '无证件' }}</el-tag>
          <el-tag size="small" :type="row.hasUnionid ? 'success' : 'info'" class="tag">{{ row.hasUnionid ? 'unionid' : '无union' }}</el-tag>
          <el-tag size="small" :type="row.hasDeviceFingerprint ? 'success' : 'info'" class="tag">{{ row.hasDeviceFingerprint ? '设备' : '无设备' }}</el-tag>
          <el-tag size="small" :type="row.newbieRewardClaimed ? 'warning' : 'info'" class="tag">{{ row.newbieRewardClaimed ? '已领新手礼' : '未领新手礼' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" width="170"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, prev, pager, next" :total="page.total" :page-size="page.size" :current-page="page.page" @current-change="(p: number) => { page.page = p; load(); }" />
    <div class="tip">敏感字段仅掩码/布尔展示（红线 I5），后台不下发证件号、手机号原文。</div>
  </div>
</template>

<style scoped>
.bar { margin-bottom: 14px; }
.kw { width: 280px; margin-right: 10px; }
.tag { margin-right: 4px; }
.tip { color: #909399; font-size: 13px; margin-top: 12px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
