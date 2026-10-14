<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const menuItems = [
  { path: '/dashboard', title: '工作台' },
  { path: '/projects', title: '项目管理' },
  { path: '/tasks', title: '任务看板' },
  { path: '/literatures', title: '文献管理' },
  { path: '/meetings', title: '会议管理' },
  { path: '/achievements', title: '成果管理' },
  { path: '/contribution', title: '参与度分析' },
  { path: '/members', title: '课题组成员' }
]

const activeMenu = computed(() => route.path)
const pageTitle = computed(() => route.meta.title ?? '')
const displayName = computed(() => userStore.userInfo?.nickname || '未登录')

function handleCommand(command: string): void {
  if (command === 'logout') {
    userStore.reset()
    void router.replace({ name: 'login' })
  }
}
</script>

<template>
  <el-container class="app-layout">
    <el-aside width="var(--app-aside-width)" class="app-aside">
      <div class="app-brand">科研协作平台</div>
      <el-menu :default-active="activeMenu" router class="app-menu">
        <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
          {{ item.title }}
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="app-header">
        <span class="app-header-title">{{ pageTitle }}</span>
        <el-dropdown @command="handleCommand">
          <span class="app-user">{{ displayName }}</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-layout {
  height: 100%;
}

.app-aside {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid var(--app-border);
}

.app-brand {
  height: var(--app-header-height);
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 15px;
  color: #303133;
  border-bottom: 1px solid var(--app-border);
}

.app-menu {
  flex: 1;
  border-right: none;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--app-header-height);
  background: #ffffff;
  border-bottom: 1px solid var(--app-border);
}

.app-header-title {
  font-size: 15px;
  color: #303133;
}

.app-user {
  cursor: pointer;
  color: #606266;
  outline: none;
}

.app-main {
  padding: 16px;
  overflow-y: auto;
}
</style>
