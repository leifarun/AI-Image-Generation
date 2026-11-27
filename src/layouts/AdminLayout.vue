<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const menus = computed(() => {
  const items: Array<{ path: string; title: string; adminOnly?: boolean; children?: Array<{ path: string; title: string }> }> = [
    { path: '/dashboard', title: '工作台' },
    { path: '/tasks', title: '生成任务' },
    { path: '/sop-templates', title: '指令模板', adminOnly: true },
    {
      path: '/settings',
      title: '系统管理',
      adminOnly: true,
      children: [
        { path: '/settings/staff', title: '员工账号' },
        { path: '/settings/general', title: '系统设置' }
      ]
    }
  ]
  return userStore.role === 'admin' ? items : items.filter((i) => !i.adminOnly)
})

const activeMenu = computed(() => {
  if (route.path.startsWith('/tasks')) return '/tasks'
  return route.path
})

const breadcrumb = computed(() => (route.meta.title as string) ?? '')

async function handleCommand(command: string) {
  if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
    userStore.logout()
    router.push('/login')
  }
}
</script>

<template>
  <div class="admin-layout">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-badge">AI</span>
        <span class="logo-text">AI 图片工场</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#1f2d3d"
        text-color="#bfcbd9"
        active-text-color="#ffffff"
        class="sidebar-menu"
      >
        <template v-for="item in menus" :key="item.path">
          <el-sub-menu v-if="item.children" :index="item.path">
            <template #title>{{ item.title }}</template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              {{ child.title }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">{{ item.title }}</el-menu-item>
        </template>
      </el-menu>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="breadcrumb">{{ breadcrumb }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="topbar-right">
          <el-dropdown @command="handleCommand">
            <span class="user-entry">
              <span class="avatar">{{ userStore.name.slice(0, 1) || '?' }}</span>
              <span class="username">{{ userStore.name }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <el-alert
        v-if="userStore.isPreview"
        title="当前为界面预览模式：尚未连接数据库，页面为界面骨架，登录与业务功能将在接通 Supabase 后启用"
        type="warning"
        show-icon
        :closable="false"
        class="preview-banner"
      />

      <main class="content">
        <router-view v-slot="{ Component }">
          <keep-alive include="DashboardView,TaskListView">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.admin-layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  flex-shrink: 0;
  background-color: #1f2d3d;
  display: flex;
  flex-direction: column;

  .logo {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

    .logo-badge {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: #185fa5;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .logo-text {
      color: #fff;
      font-size: 14px;
      font-weight: 500;
    }
  }

  .sidebar-menu {
    border-right: none;
    flex: 1;
    overflow-y: auto;
  }
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 48px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;

  .user-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;

    .avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #185fa5;
      color: #fff;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .username {
      font-size: 13px;
      color: #303133;
    }
  }
}

.preview-banner {
  flex-shrink: 0;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
</style>
