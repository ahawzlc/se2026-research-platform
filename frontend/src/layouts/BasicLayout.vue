<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, notificationsApi } from '@/api'
import type { NotificationItem } from '@/api/notifications'
import ProfileSettingsDialog from '@/components/ProfileSettingsDialog.vue'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// token 持久化在 localStorage，userInfo 只在内存：刷新后凭 token 重新拉取；
// 失败（401）由 Axios 响应拦截器统一清态并跳登录，这里无需额外处理
onMounted(() => {
  if (userStore.token && !userStore.userInfo) {
    authApi
      .fetchMe()
      .then((info) => userStore.setUserInfo(info))
      .catch(() => {})
  }
  // 通知铃铛（卡 G-1）：未读数 30s 轮询，与消息页未读同节奏、各自独立互不覆盖
  void pollUnread()
  pollTimer = setInterval(() => {
    void pollUnread()
  }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

// ---------------------------------------------------------------- 通知铃铛
const POLL_INTERVAL_MS = 30_000
const unreadCount = ref(0)
const recentList = ref<NotificationItem[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

async function pollUnread(): Promise<void> {
  if (!userStore.token) return
  try {
    const data = await notificationsApi.fetchUnreadCount()
    unreadCount.value = data.count
  } catch {
    // 轮询失败静默处理，不打扰用户
  }
}

async function loadRecent(): Promise<void> {
  try {
    const data = await notificationsApi.fetchNotifications({ page: 1, size: 5 })
    recentList.value = data.list
  } catch {
    // 提示由拦截器统一处理
  }
}

function refTarget(item: NotificationItem): string {
  // 已知来源跳对应页面；friendship 待线③页面落地后接入
  if (item.refType === 'community_post') {
    // 「有人申请加入」直达该帖的申请管理页签，其余社区通知进详情
    const tab = item.type === 'team_apply' ? '?tab=applications' : ''
    return `/community/${item.refId}${tab}`
  }
  if (item.refType === 'meeting') return '/meetings'
  if (item.refType === 'conversation') return '/messages'
  return ''
}

async function handleNoticeClick(item: NotificationItem): Promise<void> {
  if (!item.isRead) {
    try {
      await notificationsApi.markNotificationRead(item.id)
    } catch {
      return
    }
    item.isRead = 1
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }
  const target = refTarget(item)
  if (target) void router.push(target)
}

function goAllNotifications(): void {
  void router.push('/notifications')
}

const menuItems = [
  { path: '/dashboard', title: '工作台' },
  { path: '/community', title: '组队广场' },
  { path: '/overview', title: '项目概览' },
  { path: '/projects', title: '项目管理' },
  { path: '/tasks', title: '任务看板' },
  { path: '/gantt', title: '甘特图' },
  { path: '/literatures', title: '文献管理' },
  { path: '/meetings', title: '会议管理' },
  { path: '/achievements', title: '成果管理' },
  { path: '/messages', title: '协作消息' },
  { path: '/contribution', title: '参与度分析' },
  { path: '/members', title: '课题组成员' }
]

// 子页面（如 /community/12）让所属菜单项保持高亮
const activeMenu = computed(
  () => menuItems.find((item) => route.path.startsWith(`${item.path}/`))?.path ?? route.path
)
const pageTitle = computed(() => route.meta.title ?? '')
const displayName = computed(() => userStore.userInfo?.nickname || '未登录')

function handleCommand(command: string): void {
  if (command === 'logout') {
    userStore.reset()
    void router.replace({ name: 'login' })
  } else if (command === 'settings') {
    settingsVisible.value = true
  }
}

/** 个人设置弹窗（卡 A-补1 资料 / A-补2 改密） */
const settingsVisible = ref(false)
</script>

<template>
  <el-container
    class="app-layout"
    :class="{ 'participation-layout': route.name === 'contribution' }"
  >
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
        <div class="app-header-right">
          <el-popover placement="bottom-end" :width="360" trigger="click" @show="loadRecent">
            <template #reference>
              <el-badge
                :value="unreadCount"
                :hidden="unreadCount === 0"
                :max="99"
                class="bell-badge"
              >
                <span class="bell-icon">🔔</span>
              </el-badge>
            </template>
            <div class="bell-panel">
              <div class="bell-panel-head">
                <span>通知</span>
                <el-button link type="primary" size="small" @click="goAllNotifications">
                  查看全部
                </el-button>
              </div>
              <div v-if="recentList.length === 0" class="bell-empty">暂无通知</div>
              <div
                v-for="item in recentList"
                :key="item.id"
                class="bell-item"
                :class="{ 'is-unread': !item.isRead }"
                @click="handleNoticeClick(item)"
              >
                <div class="bell-item-title">{{ item.title }}</div>
                <div class="bell-item-time">{{ item.createdAt }}</div>
              </div>
            </div>
          </el-popover>
          <el-dropdown @command="handleCommand">
            <span class="app-user">{{ displayName }}</span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">个人设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 个人设置（资料/改密），全局入口挂在顶栏用户下拉 -->
    <ProfileSettingsDialog v-model="settingsVisible" />
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

.app-header-right {
  display: flex;
  align-items: center;
  gap: 18px;
}

.bell-icon {
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.bell-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  font-weight: 600;
  color: #303133;
}

.bell-empty {
  padding: 12px 0;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.bell-item {
  padding: 8px 4px;
  border-bottom: 1px dashed #ebeef5;
  cursor: pointer;
}

.bell-item:hover {
  background: #f5f7fa;
}

.is-unread .bell-item-title {
  font-weight: 600;
}

.bell-item-time {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
}

.app-main {
  padding: 16px;
  overflow-y: auto;
}
@media (max-width: 720px) {
  .participation-layout {
    flex-direction: column;
  }
  .participation-layout .app-aside {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--app-border);
  }
  .participation-layout .app-brand {
    height: 38px;
    padding: 0 12px;
  }
  .participation-layout .app-menu {
    display: flex;
    overflow-x: auto;
  }
  .participation-layout .app-menu :deep(.el-menu-item) {
    flex: none;
    height: 40px;
    padding: 0 12px;
  }
  .participation-layout .app-main {
    padding: 10px;
  }
}
</style>
