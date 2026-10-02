import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  // Step 13：审核工作台 / 额度账本 / 订单 / 配置中心 / 工单 / 看板
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
