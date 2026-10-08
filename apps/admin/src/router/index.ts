import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { auth } from '../api';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '数据看板' } },
  { path: '/audit/profiles', name: 'audit-profiles', component: () => import('../views/AuditProfilesView.vue'), meta: { title: '档案审核' } },
  { path: '/audit/certifications', name: 'audit-certifications', component: () => import('../views/CertificationsView.vue'), meta: { title: '实名复核' } },
  { path: '/users', name: 'users', component: () => import('../views/UsersView.vue'), meta: { title: '用户查询' } },
  { path: '/quotas', name: 'quotas', component: () => import('../views/QuotasView.vue'), meta: { title: '额度账本' } },
  { path: '/orders', name: 'orders', component: () => import('../views/OrdersView.vue'), meta: { title: '订单与退款' } },
  { path: '/config', name: 'config', component: () => import('../views/ConfigView.vue'), meta: { title: '配置中心' } },
  { path: '/ops-slots', name: 'ops-slots', component: () => import('../views/OpsSlotsView.vue'), meta: { title: '运营位' } },
  { path: '/tickets', name: 'tickets', component: () => import('../views/TicketsView.vue'), meta: { title: '工单' } },
  { path: '/manager-leads', name: 'manager-leads', component: () => import('../views/ManagerLeadsView.vue'), meta: { title: '管家留资派单' } },
  { path: '/risk-events', name: 'risk-events', component: () => import('../views/RiskEventsView.vue'), meta: { title: 'IM 风控' } },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  if (to.name !== 'login' && !auth.token) return { name: 'login' };
  if (to.name === 'login' && auth.token) return { name: 'dashboard' };
  return true;
});

export default router;
