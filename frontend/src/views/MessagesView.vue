<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi, conversationsApi, fileApi, projectsApi, teamsApi } from '@/api'
import type { ConversationItem, ConversationType, MessageItem } from '@/api/conversations'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'
import { useUserStore } from '@/store/user'
import { formatFileSize } from '@/utils/display'

/** 会话类型中文名与标签配色（comment 为 B-3 任务评论复用的锚定会话，零未读） */
const TYPE_META: Record<ConversationType, { label: string; tag: 'info' | 'success' | 'warning' | 'danger' }> = {
    comment: { label: '任务评论', tag: 'info' },
    group: { label: '项目讨论区', tag: 'success' },
    private: { label: '私信', tag: 'warning' },
    meeting: { label: '会议讨论区', tag: 'danger' }
}

/** 未读轮询间隔：SRS 口径 30 秒（docs/01 已废弃旧 3–5 秒） */
const POLL_INTERVAL_MS = 30_000

const userStore = useUserStore()
const route = useRoute()
const myUserId = computed(() => userStore.userInfo?.id ?? '')
const router = useRouter()

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
    // size 给足：会话列表**只取第 1 页**，条数不够时新会话会看不到。
    // ⚠️ 上限是 100（后端 DTO 的 @Max(100)），超了会被 400 拒掉、列表直接空。
    const result = await conversationsApi.fetchConversations({ page: 1, size: 100 })
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

/**
 * 当前会话是否只读。
 *
 * 只有**会议讨论区**可能是只读的（会议已结束或已删除）。
 * 消息页不查这个接口的话，用户在这里选附件 → 写说明 → 回车，
 * 会先上传成功（201）再被发消息接口拒掉（403），
 * file 表里就多一行没人引用的孤儿文件——按一次多一行。
 */
const activeReadOnly = ref(false)
const activeReadOnlyReason = ref('')

/**
 * 查询会话是否只读。
 *
 * 非会议会话恒为 false，不发请求。
 */
async function fetchReadOnly(conv: ConversationItem): Promise<void> {
  if (conv.type !== 'meeting') {
    activeReadOnly.value = false
    activeReadOnlyReason.value = ''
    return
  }
  try {
    const ro = await conversationsApi.fetchMeetingDiscussionReadOnly(conv.id)
    activeReadOnly.value = ro.readOnly
    activeReadOnlyReason.value = ro.reason
  } catch {
    // 查不到只读状态时保守处理：不锁死输入框（后端发消息时还会再拦一次）
    activeReadOnly.value = false
    activeReadOnlyReason.value = ''
  }
}

async function openConversation(conv: ConversationItem): Promise<void> {
  if (activeId.value === conv.id) return
  activeId.value = conv.id
  messagesLoading.value = true
  messages.value = []
  activeReadOnly.value = false
  activeReadOnlyReason.value = ''
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
  // 查只读状态（只有会议讨论区可能只读）
  await fetchReadOnly(conv)
}

async function handleSend(): Promise<void> {
  const content = draft.value.trim()
  if (!content || !activeId.value || sending.value) return
  if (activeReadOnly.value) return
  sending.value = true
  try {
    // 有附件时先传文件拿到 fileId，再带 fileId 发消息（两段式）。
    //
    // 上传成功但发消息失败时**保留 uploadedFileId** 供重试：
    // 若每次重试都重新上传，file 表里会堆一堆没人引用的孤儿文件。
    let fileId = uploadedFileId.value
    if (!fileId && pendingFile.value) {
      const uploaded = await fileApi.uploadFile(pendingFile.value)
      fileId = uploaded.id
      // 先记下来：万一发消息失败，重试时直接复用这个已上传的附件
      uploadedFileId.value = uploaded.id
    }
    const message = await conversationsApi.sendMessage(activeId.value, content, fileId)
    messages.value.push(message)
    draft.value = ''
    pendingFile.value = undefined
    uploadedFileId.value = undefined
    await scrollToBottom()
    // 同步左侧预览（消息零埋点，无需其他联动）
    const conv = conversations.value.find((c) => c.id === activeId.value)
    if (conv) {
      conv.lastMessage = content
      conv.lastMessageAt = message.createdAt
    }
  } catch {
    // 提示由拦截器统一处理。
    // 失败时保留 pendingFile / uploadedFileId，用户可以直接重试，不会重复上传。
  } finally {
    sending.value = false
  }
}

/**
 * 待发送的附件（线③ 收尾）。
 *
 * 只在内存里暂存，**不上传即选中**——避免用户选了个文件又取消，
 * 服务器上却留下一条没人引用的 file 记录（孤儿文件）。
 * 真正的上传发生在点「发送」那一刻。
 */
const pendingFile = ref<File | undefined>()

/**
 * 已上传但还没发出去的附件 id。
 *
 * 上传与发消息是两段式，中间可能失败（403 只读、403 非好友限发等）。
 * 记下已上传的 id，重试时直接复用，不重新上传——否则每次重试都往
 * file 表塞一行没人引用的孤儿记录。
 */
const uploadedFileId = ref<string | undefined>()

/** 上传组件实例：选中后立刻清空内部列表，才能重复选同一个文件 */
const uploadRef = ref<{ clearFiles: () => void } | undefined>()

/**
 * 附件选择回调。
 *
 * `on-change` 在 auto-upload=false 时于「选中文件」时触发，
 * 原始 File 对象在 `raw` 里（`uploadFile` 是 el-upload 的包装对象，不是浏览器 File）。
 */
function handleFileChange(uploadFile: { raw?: File }): void {
  pendingFile.value = uploadFile.raw
  // 换了新附件，之前那个已上传的 id 就不再适用了
  uploadedFileId.value = undefined
  // 清空内部列表：否则第二次选同一文件会被 limit 拦下
  uploadRef.value?.clearFiles()
}

/** 移除待发送的附件（连同已上传的 id） */
function handleFileRemove(): void {
  pendingFile.value = undefined
  uploadedFileId.value = undefined
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
/** 按 UID 发起（线③ 卡 E-3：私信不再要求同组，故允许直接输入 UID） */
const peerUid = ref('')
/** 私信候选：我所在课题组的全部成员（去重、排除自己）；组外的人走 UID 输入 */
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
  peerUid.value = ''
  privateVisible.value = true
  if (candidateMembers.value.length === 0) {
    void loadCandidates()
  }
}

async function handlePrivateCreate(): Promise<void> {
  const uid = peerUid.value.trim()
  if (!peerUserId.value && !uid) return
  privateLoading.value = true
  try {
    const conv = uid
      ? await conversationsApi.openPrivateConversationByUid(uid)
      : await conversationsApi.ensurePrivateConversation(peerUserId.value)
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

/**
 * 支持从好友页 / 个人主页跳过来时直接打开指定会话：
 * 路由带 ?conversation=<id> 时，会话列表加载完成后自动打开该会话。
 */

async function openFromRoute(): Promise<void> {
  const target = route.query.conversation
  if (typeof target !== 'string' || !target) return
  const conv = conversations.value.find((c) => c.id === target)
  if (conv) {
    await openConversation(conv)
    // 打开后清掉 query，避免刷新时重复触发
    await router.replace({ path: '/messages' })
  }
}

onMounted(async () => {
  // userInfo 只在内存，刷新后凭 token 回填（同 BasicLayout 的做法）
  if (userStore.token && !userStore.userInfo) {
    await authApi
      .fetchMe()
      .then((info) => userStore.setUserInfo(info))
      .catch(() => {})
  }
  await loadConversations()
  // 两个直达参数都要处理：
  //   ?conversation=<id> → 本卡（线③ E-3）：从好友页 / 个人主页跳过来
  //   ?peer=<uid>       → 线②：按 UID 打开私信会话
  await openFromRoute()
  await openPeerFromRoute()
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
            <el-button size="small" @click="router.push('/friends')">好友</el-button>
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
              <!-- 文件消息（线③ 收尾）：附件卡片；附件被删除时后端不下发 file，降级为纯文本 -->
              <a
                v-if="msg.msgType === 'file' && msg.file"
                class="msg-file"
                :href="msg.file.url"
                target="_blank"
                rel="noopener noreferrer"
                :download="msg.file.originalName"
              >
                <span class="msg-file-icon" aria-hidden="true">📎</span>
                <span class="msg-file-name">{{ msg.file.originalName }}</span>
                <span class="msg-file-size">{{ formatFileSize(msg.file.size) }}</span>
              </a>
              <div class="msg-time">{{ msg.createdAt }}</div>
            </div>
          </div>
        </div>
        <div class="msg-input">
          <!-- 只读会话（会议已结束/已删除）：禁用输入框并说明原因。
               不这样做的话，用户在这里选附件 → 回车，会先上传成功再被 403 拒掉，
               file 表里多一行没人引用的孤儿文件。 -->
          <p v-if="activeReadOnly" class="msg-readonly-hint">
            {{ activeReadOnlyReason || '该讨论区只读，不能发言' }}
          </p>
          <!-- 待发送的附件（线③ 收尾）：显示在输入框上方，点发送才真正上传 -->
          <div v-if="pendingFile" class="msg-pending-file">
            <span class="msg-file-icon" aria-hidden="true">📎</span>
            <span class="msg-file-name">{{ pendingFile.name }}</span>
            <span class="msg-file-size">{{ formatFileSize(pendingFile.size) }}</span>
            <el-button link type="danger" @click="handleFileRemove">移除</el-button>
          </div>
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="2000"
            :disabled="activeReadOnly"
            :placeholder="
              activeReadOnly
                ? activeReadOnlyReason || '该讨论区只读，不能发言'
                : '输入消息，Enter 发送，Shift+Enter 换行'
            "
            @keydown.enter.exact.prevent="handleSend"
          />
          <el-upload
            ref="uploadRef"
            class="msg-upload"
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleFileChange"
          >
            <el-button :disabled="!activeId || activeReadOnly">
              <span aria-hidden="true">📎</span>
              <span class="msg-upload-text">附件</span>
            </el-button>
          </el-upload>
          <el-button
            type="primary"
            :loading="sending"
            :disabled="!draft.trim() || !activeId || activeReadOnly"
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
      <el-divider>或按 UID 找人</el-divider>
      <el-input
        v-model="peerUid"
        placeholder="输入对方 UID（如 U0000000123）"
        clearable
        @keyup.enter="handlePrivateCreate"
      />
      <p class="dialog-hint">
        非好友之间每个方向只能发一条消息；成为好友后可自由交流
      </p>
      <template #footer>
        <el-button @click="privateVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!peerUserId && !peerUid.trim()"
          :loading="privateLoading"
          @click="handlePrivateCreate"
        >
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

/* 附件卡片（线③ 收尾） */
.msg-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  color: #409eff;
  text-decoration: none;
  font-size: 13px;
  max-width: 100%;
}

.msg-file:hover {
  border-color: #409eff;
}

.msg-file-icon {
  font-size: 14px;
}

.msg-file-name {
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.msg-file-size {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

/* 待发送的附件（选中但还没上传） */
.msg-pending-file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 0;
  font-size: 13px;
}

/* 只读会话的说明（线③ PR #51 评审） */
.msg-readonly-hint {
  margin: 0 0 2px;
  width: 100%;
  color: #909399;
  font-size: 12px;
}

.msg-pending-file .msg-file-name {
  color: #303133;
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
  flex-wrap: wrap;
}

.msg-upload-text {
  margin-left: 4px;
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
