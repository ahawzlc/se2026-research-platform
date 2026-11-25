<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notificationsApi } from '@/api'
import type { NotificationItem } from '@/api/notifications'

/**
 * 通知中心页（卡 G-1，线①）。
 * 点击通知：标记已读并按 refType 跳来源；线②③页面落地前未知来源只标已读不跳转。
 */
const router = useRouter()

const list = ref<NotificationItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const unreadOnly = ref(false)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await notificationsApi.fetchNotifications({
      page: page.value,
      size: size.value,
      unreadOnly: unreadOnly.value
    })
    list.value = data.list
    total.value = data.total
  } catch {
    // 提示由拦截器统一处理
  } finally {
    loading.value = false
  }
}

function refTarget(item: NotificationItem): string {
  // 已知来源跳对应页面；friendship 待线③页面落地后接入
  if (item.refType === 'community_post') {
    // 「有人申请加入」直达该帖的申请管理页签，其余社区通知进详情
    const tab = item.type === 'team_apply' ? '?tab=applications' : ''
    return `/community/${item.refId}${tab}`
  }
  if (item.refType === 'meeting') return `/meetings?meetingId=${encodeURIComponent(item.refId)}`
  if (item.refType === 'conversation') return '/messages'
  return ''
}

async function handleClick(item: NotificationItem) {
  if (!item.isRead) {
    try {
      await notificationsApi.markNotificationRead(item.id)
      item.isRead = 1
    } catch {
      return
    }
  }
  const target = refTarget(item)
  if (target) void router.push(target)
}

async function handleReadAll() {
  try {
    await notificationsApi.markAllNotificationsRead()
    await load()
  } catch {
    // 提示由拦截器统一处理
  }
}

function toggleUnread() {
  page.value = 1
  void load()
}

function changePage(p: number) {
  page.value = p
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="notifications-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-actions">
          <el-checkbox v-model="unreadOnly" @change="toggleUnread">仅看未读</el-checkbox>
          <el-button size="small" :disabled="total === 0" @click="handleReadAll">
            全部已读
          </el-button>
        </div>
      </template>

      <div v-loading="loading" class="notice-list">
        <div v-if="list.length === 0 && !loading" class="empty-tip">暂无通知</div>
        <div
          v-for="item in list"
          :key="item.id"
          class="notice-item"
          :class="{ 'is-unread': !item.isRead }"
          @click="handleClick(item)"
        >
          <div class="notice-title">
            <span v-if="!item.isRead" class="notice-dot" />
            <span>{{ item.title }}</span>
          </div>
          <div class="notice-time">{{ item.createdAt }}</div>
        </div>
      </div>

      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :current-page="page"
          :page-size="size"
          @current-change="changePage"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.notifications-page {
  max-width: 860px;
}

.page-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.empty-tip {
  color: #909399;
  text-align: center;
  padding: 32px 0;
}

.notice-item {
  padding: 12px 4px;
  border-bottom: 1px dashed #ebeef5;
  cursor: pointer;
}

.notice-item:hover {
  background: #f5f7fa;
}

.notice-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #303133;
}

.is-unread .notice-title {
  font-weight: 600;
}

.notice-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f56c6c;
  flex: none;
}

.notice-time {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
