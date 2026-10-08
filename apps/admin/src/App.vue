<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { auth } from './api';

const route = useRoute();
const router = useRouter();

const isLogin = computed(() => route.name === 'login');
const roleLabel: Record<string, string> = { SUPER: '超管', REVIEWER: '审核员', OPERATOR: '运营', FINANCE: '财务' };

async function logout() {
  await ElMessageBox.confirm('确认退出登录？', '退出', { type: 'warning' }).catch(() => null);
  auth.clear();
  void router.replace('/login');
}
</script>

<template>
  <router-view v-if="isLogin" />
  <el-container v-else class="shell">
    <el-aside width="210px" class="aside">
      <div class="logo">完美亲家 · 管理后台</div>
      <el-menu :default-active="route.path" router class="menu">
        <el-menu-item index="/">数据看板</el-menu-item>
        <el-sub-menu index="audit">
          <template #title>审核工作台</template>
          <el-menu-item index="/audit/profiles">档案审核</el-menu-item>
          <el-menu-item index="/audit/certifications">实名复核</el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/users">用户查询</el-menu-item>
        <el-menu-item index="/quotas">额度账本</el-menu-item>
        <el-menu-item index="/orders">订单与退款</el-menu-item>
        <el-menu-item index="/config">配置中心</el-menu-item>
        <el-menu-item index="/ops-slots">运营位</el-menu-item>
        <el-menu-item index="/tickets">工单</el-menu-item>
        <el-menu-item index="/manager-leads">管家派单</el-menu-item>
        <el-menu-item index="/risk-events">IM 风控</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <text class="page-title">{{ route.meta.title }}</text>
        <div class="who">
          <el-tag size="small" type="warning">{{ roleLabel[auth.role] ?? auth.role }}</el-tag>
          <span class="name">{{ auth.username }}</span>
          <el-button link type="danger" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main"><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<style>
html, body, #app { height: 100%; margin: 0; font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
</style>

<style scoped>
.shell { height: 100%; }
.aside { background: #1f2d3d; }
.logo { color: #fff; font-size: 16px; font-weight: bold; padding: 18px 16px; border-bottom: 1px solid #2c3e50; }
.menu { border-right: none; background: transparent; }
.menu :deep(.el-menu-item), .menu :deep(.el-sub-menu__title) { color: #c0c8d0; }
.menu :deep(.el-menu-item.is-active) { color: #ffd04b; background: #263445; }
.menu :deep(.el-menu) { background: #1f2d3d; }
.menu :deep(.el-menu .el-menu) { background: #263445; }
.header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #eee; }
.page-title { font-size: 17px; font-weight: bold; color: #333; }
.who { display: flex; align-items: center; gap: 10px; }
.name { color: #666; font-size: 14px; }
.main { background: #f5f7fa; }
</style>
