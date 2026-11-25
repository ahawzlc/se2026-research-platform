<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { authApi, conversationsApi, projectsApi, teamsApi } from '@/api'
import type { ConversationItem, ConversationType, MessageItem } from '@/api/conversations'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'
import { useUserStore } from '@/store/user'

/** 会话类型中文名与标签配色（comment 为 B-3 任务评论复用的锚定会话，零未读） */
const TYPE_META: Record<ConversationType, { label: string; tag: 'info' | 'success' | 'warning' }> = {
  comment: { label: '任务评论', tag: 'info' },
  group: { label: '项目讨论区', tag: 'success' },
  private: { label: '私信', tag: 'warning' }
}

/** 未读轮询间隔：SRS 口径 30 秒（docs/01 已废弃旧 3–5 秒） */
const POLL_INTERVAL_MS = 30_000

const userStore = useUserStore()
const route = useRoute()
const myUserId = computed(() => userStore.userInfo?.id ?? '')

// ---------------------------------------------------------------- 会话列表

const conversations = ref<ConversationItem[]>([])
const listLoading = ref(false)
const activeId = ref('')

const activeConversation = computed(() =>
  conversations.value.find((c) => c.id === activeId.value)
)

async function loadConversations(): Promise<void> {
  listLoading.value = true
  try {
    const result = await conversationsApi.fetchConversations({ page: 1, size: 50 })
    conversations.value = result.list
    // 列表刷新后当前会话可能更新（预览/时间），消息区不动
  } finally {
    listLoading.value = false
  }
}

/**
 * 30 秒未读轮询（docs/01 指定走轻量的 unread 汇总接口）：
 * 只合并未读数；若出现列表里没有的会话 id（别人新发起的私信），才整表刷新。
 */
async function pollUnread(): Promise<void> {
  const items = await conversationsApi.fetchUnread()
  const known = new Set(conversations.value.map((c) => c.id))
  const hasNew = items.some((u) => !known.has(u.conversationId))
  if (hasNew) {
    await loadConversations()
    return
  }
  const byId = new Map(items.map((u) => [u.conversationId, u.unreadCount]))
  for (const conv of conversations.value) {
    conv.unreadCount = byId.get(conv.id) ?? 0
  }
}

// ---------------------------------------------------------------- 消息区

const messages = ref<MessageItem[]>([])
const messagesLoading = ref(false)
const draft = ref('')
const sending = ref(false)
const scrollRef = ref<HTMLElement>()

async function openConversation(conv: ConversationItem): Promise<void> {
  if (activeId.value === conv.id) return
  activeId.value = conv.id
  messagesLoading.value = true
  messages.value = []
  try {
    messages.value = await conversationsApi.fetchMessages(conv.id, 200)
    await scrollToBottom()
  } finally {
    messagesLoading.value = false
  }
  // 进入会话即标记已读；comment 类型后端恒为 0，无副作用
  if (conv.unreadCount > 0) {
    conv.unreadCount = 0
    await conversationsApi.markRead(conv.id).catch(() => {
      // 已读失败不阻塞浏览；下次轮询会纠正未读数
    })
  }
}

async function handleSend(): Promise<void> {
  const content = draft.value.trim()
  if (!content || !activeId.value || sending.value) return
  sending.value = true
  try {
    const message = await conversationsApi.sendMessage(activeId.value, content)
    messages.value.push(message)
    draft.value = ''
    await scrollToBottom()
    // 同步左侧预览（消息零埋点，无需其他联动）
    const conv = conversations.value.find((c) => c.id === activeId.value)
    if (conv) {
      conv.lastMessage = content
      conv.lastMessageAt = message.createdAt
    }
  } catch {
    // 提示由拦截器统一处理
  } finally {
    sending.value = false
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------- 发起会话

const privateVisible = ref(false)
const privateLoading = ref(false)
const peerUserId = ref('')
/** 私信对象：我所在课题组的全部成员（去重、排除自己），双方同组是后端硬约束 */
const candidateMembers = ref<TeamMemberItem[]>([])

const groupVisible = ref(false)
const groupLoading = ref(false)
const groupProjectId = ref('')
const projects = ref<ProjectItem[]>([])

async function loadCandidates(): Promise<void> {
  const teams = await teamsApi.fetchMyTeams()
  const byId = new Map<string, TeamMemberItem>()
  for (const team of teams) {
    const result = await teamsApi.fetchTeamMembers(team.id, { page: 1, size: 100 })
    for (const m of result.list) {
      if (m.userId !== myUserId.value) byId.set(m.userId, m)
    }
  }
  candidateMembers.value = [...byId.values()]
}

function openPrivateDialog(): void {
  peerUserId.value = ''
  privateVisible.value = true
  if (candidateMembers.value.length === 0) {
    void loadCandidates()
  }
}

async function handlePrivateCreate(): Promise<void> {
  if (!peerUserId.value) return
  privateLoading.value = true
  try {
    const conv = await conversationsApi.ensurePrivateConversation(peerUserId.value)
    privateVisible.value = false
    await loadConversations()
    const target = conversations.value.find((c) => c.id === conv.id)
    if (target) await openConversation(target)
  } catch {
    // 提示由拦截器统一处理
  } finally {
    privateLoading.value = false
  }
}

/**
 * 入口接缝（线② 卡 E-1「私信 TA」）：带 /messages?peer=<userId> 进入时，
 * 直接打开（或新建）与该用户的私信会话。打开（或新建）本身幂等——已有会话直接定位，
 * 所以刷新页面再次进入也不会多建会话。
 */
async function openPeerFromRoute(): Promise<void> {
  const peer = route.query.peer
  if (typeof peer !== 'string' || !peer) return
  try {
    const conv = await conversationsApi.ensurePrivateConversation(peer)
    await loadConversations()
    const target = conversations.value.find((c) => c.id === conv.id)
    if (target) await openConversation(target)
  } catch {
    // 不满足私信条件时提示由拦截器统一处理
  }
}

function openGroupDialog(): void {
  groupProjectId.value = ''
  groupVisible.value = true
  if (projects.value.length === 0) {
    void projectsApi
      .fetchProjects({ page: 1, size: 100 })
      .then((r) => (projects.value = r.list))
  }
}

async function handleGroupCreate(): Promise<void> {
  if (!groupProjectId.value) return
  groupLoading.value = true
  try {
    const conv = await conversationsApi.ensureGroupConversation(groupProjectId.value)
    groupVisible.value = false
    await loadConversations()
    const target = conversations.value.find((c) => c.id === conv.id)
    if (target) await openConversation(target)
  } catch {
    // 提示由拦截器统一处理
  } finally {
    groupLoading.value = false
  }
}

// ---------------------------------------------------------------- 生命周期

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // userInfo 只在内存，刷新后凭 token 回填（同 BasicLayout 的做法）
  if (userStore.token && !userStore.userInfo) {
    authApi
      .fetchMe()
      .then((info) => userStore.setUserInfo(info))
      .catch(() => {})
  }
  void loadConversations()
  void openPeerFromRoute()
  void pollUnread()
  pollTimer = setInterval(() => {
    void pollUnread()
  }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="messages-page">
    <!-- 左栏：会话列表 -->
    <el-card shadow="never" class="conv-card" :body-style="{ padding: 0 }">
      <template #header>
        <div class="conv-header">
          <span class="conv-title">会话</span>
          <div class="conv-actions">
            <el-button size="small" @click="openPrivateDialog">私信</el-button>
            <el-button size="small" type="primary" @click="openGroupDialog">讨论区</el-button>
          </div>
        </div>
      </template>

      <div v-loading="listLoading" class="conv-list">
        <el-empty
          v-if="conversations.length === 0 && !listLoading"
          description="暂无会话"
          :image-size="60"
        >
          <p class="empty-hint">点右上角「私信」或「讨论区」发起第一个会话</p>
        </el-empty>
        <div
          v-for="conv in conversations"
          :key="conv.id"
          class="conv-item"
          :class="{ 'is-active': conv.id === activeId }"
          @click="openConversation(conv)"
        >
          <div class="conv-line">
            <el-tag size="small" :type="TYPE_META[conv.type as ConversationType].tag" effect="plain">
              {{ TYPE_META[conv.type as ConversationType].label }}
            </el-tag>
            <span class="conv-name">{{ conv.title || TYPE_META[conv.type as ConversationType].label }}</span>
            <el-badge
              v-if="conv.unreadCount > 0"
              :value="conv.unreadCount > 99 ? '99+' : conv.unreadCount"
              class="conv-badge"
            />
          </div>
          <div class="conv-preview">
            <span class="preview-text">{{ conv.lastMessage || '还没有消息' }}</span>
            <span class="preview-time">{{ conv.lastMessageAt || conv.updatedAt }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 右栏：消息区 -->
    <el-card shadow="never" class="chat-card" :body-style="{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }">
      <template #header>
        <div class="chat-header">
          <template v-if="activeConversation">
            <el-tag size="small" :type="TYPE_META[activeConversation.type as ConversationType].tag" effect="plain">
              {{ TYPE_META[activeConversation.type as ConversationType].label }}
            </el-tag>
            <span class="chat-name">{{ activeConversation.title || TYPE_META[activeConversation.type as ConversationType].label }}</span>
          </template>
          <span v-else class="chat-name muted">选择左侧会话开始</span>
          <span class="chat-hint">消息不计入参与度统计</span>
        </div>
      </template>

      <div v-if="activeConversation" class="chat-body">
        <div ref="scrollRef" v-loading="messagesLoading" class="msg-scroll">
          <el-empty
            v-if="messages.length === 0 && !messagesLoading"
            description="还没有消息，发第一条吧"
            :image-size="60"
          />
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="msg-row"
            :class="{ 'is-mine': msg.senderId === myUserId }"
          >
            <div class="msg-bubble">
              <div v-if="msg.senderId !== myUserId" class="msg-sender">{{ msg.senderName }}</div>
              <div class="msg-content">{{ msg.content }}</div>
              <div class="msg-time">{{ msg.createdAt }}</div>
            </div>
          </div>
        </div>
        <div class="msg-input">
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            @keydown.enter.exact.prevent="handleSend"
          />
          <el-button
            type="primary"
            :loading="sending"
            :disabled="!draft.trim() || !activeId"
            @click="handleSend"
          >
            发送
          </el-button>
        </div>
      </div>
      <div v-else class="chat-empty">
        <el-empty description="从左侧选择一个会话，或发起私信 / 项目讨论区" />
      </div>
    </el-card>

    <!-- 发起私信 -->
    <el-dialog v-model="privateVisible" title="发起私信" width="440px">
      <el-select
        v-model="peerUserId"
        filterable
        class="full-width"
        placeholder="选择同课题组成员"
      >
        <el-option
          v-for="m in candidateMembers"
          :key="m.userId"
          :label="`${m.nickname || m.username}（@${m.username}）`"
          :value="m.userId"
        />
      </el-select>
      <template #footer>
        <el-button @click="privateVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!peerUserId" :loading="privateLoading" @click="handlePrivateCreate">
          开始私信
        </el-button>
      </template>
    </el-dialog>

    <!-- 进入项目讨论区 -->
    <el-dialog v-model="groupVisible" title="项目讨论区" width="440px">
      <el-select v-model="groupProjectId" filterable class="full-width" placeholder="选择项目">
        <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <p class="dialog-hint">一个项目一个讨论区，组内成员都可见；重复进入会复用已有讨论区</p>
      <template #footer>
        <el-button @click="groupVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!groupProjectId" :loading="groupLoading" @click="handleGroupCreate">
          进入讨论区
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.messages-page {
  display: flex;
  gap: 16px;
  height: calc(100vh - 140px);
  align-items: stretch;
}

.conv-card {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.conv-card :deep(.el-card__body) {
  flex: 1;
  overflow: hidden;
}

.conv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.conv-title {
  font-size: 14px;
  font-weight: 500;
}

.conv-actions {
  display: flex;
  gap: 6px;
}

.conv-list {
  height: 100%;
  overflow-y: auto;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}

.conv-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.conv-item:hover {
  background: #f5f7fa;
}

.conv-item.is-active {
  background: #ecf5ff;
}

.conv-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conv-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}

.conv-preview {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.preview-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #909399;
}

.preview-time {
  font-size: 11px;
  color: #c0c4cc;
  flex-shrink: 0;
}

.chat-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.chat-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.chat-hint {
  margin-left: auto;
  font-size: 12px;
  color: #c0c4cc;
}

.muted {
  color: #909399;
  font-weight: 400;
}

.chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.msg-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
}

.msg-row {
  display: flex;
  margin-bottom: 10px;
}

.msg-row.is-mine {
  justify-content: flex-end;
}

.msg-bubble {
  max-width: 72%;
  padding: 8px 12px;
  background: #f4f4f5;
  border-radius: 8px;
}

.is-mine .msg-bubble {
  background: #ecf5ff;
}

.msg-sender {
  font-size: 12px;
  color: #909399;
  margin-bottom: 2px;
}

.msg-content {
  font-size: 14px;
  color: #303133;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-time {
  margin-top: 2px;
  font-size: 11px;
  color: #c0c4cc;
  text-align: right;
}

.msg-input {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid #f0f0f0;
  align-items: flex-end;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.full-width {
  width: 100%;
}

.dialog-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
