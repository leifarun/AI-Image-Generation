import { createRouter, createWebHashHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  // 总控指令固定：Hash 路由模式（适配 GitHub Pages 静态托管）
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' }
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: '工作台' }
        },
        {
          path: 'tasks',
          name: 'task-list',
          component: () => import('@/views/TaskListView.vue'),
          meta: { title: '生成任务' }
        },
        {
          path: 'tasks/new',
          name: 'task-create',
          component: () => import('@/views/TaskDetailView.vue'),
          meta: { title: '新建任务' }
        },
        {
          path: 'tasks/:id',
          name: 'task-detail',
          component: () => import('@/views/TaskDetailView.vue'),
          meta: { title: '任务详情' }
        },
        {
          path: 'sop-templates',
          name: 'sop-templates',
          component: () => import('@/views/SopTemplatesView.vue'),
          meta: { title: '指令模板', requiresAdmin: true }
        },
        {
          path: 'settings/staff',
          name: 'staff-accounts',
          component: () => import('@/views/StaffAccountsView.vue'),
          meta: { title: '员工账号', requiresAdmin: true }
        },
        {
          path: 'settings/general',
          name: 'system-settings',
          component: () => import('@/views/SystemSettingsView.vue'),
          meta: { title: '系统设置', requiresAdmin: true }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard'
    }
  ]
})

// 路由守卫：未登录一律跳登录页；管理员页面校验角色（数据库层面另有一道保险，阶段4接通）
router.beforeEach((to) => {
  const userStore = useUserStore()
  if (to.meta.public) return true
  if (!userStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && userStore.role !== 'admin') {
    return { name: 'task-list' }
  }
  return true
})

export default router
