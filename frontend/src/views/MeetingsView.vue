<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { conversationsApi, fileApi, meetingsApi, projectsApi, teamsApi } from '@/api'
import type { MeetingItem } from '@/api/meetings'
import type { MessageItem } from '@/api/conversations'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'
import { formatFileSize } from '@/utils/display'

const route = useRoute()
const router = useRouter()
const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const meetings = ref<MeetingItem[]>([])
const teamMembers = ref<TeamMemberItem[]>([])
const loading = ref(false)

const activeTab = ref<'upcoming' | 'ended' | 'all'>('upcoming')
const page = ref(1)
const pageSize = 10

const currentProject = computed(() =>
  projects.value.find((item) => item.id === currentProjectId.value)
)

const filteredMeetings = computed(() => {
  if (activeTab.value === 'all') return meetings.value
  const filtered = meetings.value.filter((item) =>
    activeTab.value === 'upcoming'
      ? item.status === 'upcoming' || item.status === 'ongoing'
      : item.status === 'ended'
  )
  // 在分页前排序，让最近的一场会议始终出现在第一页。
  return activeTab.value === 'upcoming'
    ? filtered.sort((a, b) => a.heldAt.localeCompare(b.heldAt))
    : filtered
})

const pagedMeetings = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredMeetings.value.slice(start, start + pageSize)
})

const calendarMonth = ref(new Date())
const calendarDate = ref('')

const calendarDays = computed(() => {
  const year = calendarMonth.value.getFullYear()
  const month = calendarMonth.value.getMonth()
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
})

const monthLabel = computed(
  () => `${calendarMonth.value.getFullYear()} 年 ${calendarMonth.value.getMonth() + 1} 月`
)

const selectedCalendarMeetings = computed(() =>
  meetings.value.filter((item) => item.heldAt.startsWith(calendarDate.value))
)

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const dialogLoading = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref('')

const form = reactive({
  title: '',
  heldAt: '',
  location: '',
  content: '',
  attendeeIds: [] as string[]
})

const rules: FormRules = {
  title: [
    { required: true, message: '请输入会议主题', trigger: 'blur' },
    { max: 200, message: '主题最长 200 个字符', trigger: 'blur' }
  ],
  location: [{ max: 200, message: '地点最长 200 个字符', trigger: 'blur' }]
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<MeetingItem | null>(null)

// ---------------------------------------------------------------- 讨论区（F-1）

/**
 * 会议讨论区（线③ 卡 F-1）。
 *
 * 会话模型：`Conversation.type = meeting`，refType/refId 指向会议
 * （G-0 已定稿的枚举值，本卡不改表结构）。
 *
 * 只读口径（2026-11-27 牵头人确认）：会议已结束后讨论区**能看不能发**——
 * 历史消息作为会议存档可读，新参会人也能看，但任何人都不再能发言。
 * 「未排期」（未填开始时间）不算结束，照常可发。
 */
const discussionConversationId = ref('')
const discussionMessages = ref<MessageItem[]>([])
const discussionLoading = ref(false)
const discussionReadOnly = ref(false)
/** 只读原因（已结束 / 已删除），用于给用户不同的说明文案 */
const discussionReadOnlyReason = ref('')
/** 讨论区加载是否失败——与「还没有人发言」区分开，否则用户会误以为是空会话 */
const discussionLoadFailed = ref(false)
const discussionDraft = ref('')
const discussionSending = ref(false)
const discussionScrollRef = ref<HTMLElement>()

/** 讨论区轮询间隔：卡面口径 30 秒 */
const DISCUSSION_POLL_INTERVAL_MS = 30_000

let discussionTimer: ReturnType<typeof setInterval> | null = null
/** loadDiscussion 的请求序号：快速切换会议时用来丢弃过期的响应（避免串台） */
let discussionRequest = 0

/**
 * 用户是否把消息区往上翻过。
 *
 * 轮询拉到新消息时，只有「用户没往上翻」才自动滚到底部——
 * 否则会打断正在回看历史消息的人。
 */
const discussionPinnedToBottom = ref(true)

function handleDiscussionScroll(): void {
  const el = discussionScrollRef.value
  if (!el) return
  // 距底部 40px 以内视为「贴着底部」
  discussionPinnedToBottom.value =
    el.scrollHeight - el.scrollTop - el.clientHeight <= 40
}

/**
 * 打开会议详情后加载讨论区（失败不阻断详情展示）。
 *
 * 带请求序号保护：快速切换会议时，先发的请求可能后到，
 * 若不比对序号，A 会议的响应会覆盖 B 会议的讨论区（串台），
 * 而且发言会发到 B 的会话里。
 */
async function loadDiscussion(meetingId: string): Promise<void> {
  const request = ++discussionRequest
  discussionMessages.value = []
  discussionConversationId.value = ''
  discussionReadOnly.value = false
  discussionReadOnlyReason.value = ''
  discussionLoadFailed.value = false
  discussionLoading.value = true
  discussionPinnedToBottom.value = true
  try {
    const conv = await conversationsApi.ensureMeetingConversation(meetingId)
    if (request !== discussionRequest) return
    discussionConversationId.value = conv.id
    const list = await conversationsApi.fetchMessages(conv.id, 200)
    if (request !== discussionRequest) return
    discussionMessages.value = list
    const ro = await conversationsApi.fetchMeetingDiscussionReadOnly(conv.id)
    if (request !== discussionRequest) return
    discussionReadOnly.value = ro.readOnly
    discussionReadOnlyReason.value = ro.reason
    // 看过讨论区就算已读：否则消息页角标一直挂着未读数
    await conversationsApi.markRead(conv.id).catch(() => {
      // 已读失败不阻断浏览；下次进入会话会再标一次
    })
    if (request !== discussionRequest) return
    await scrollDiscussionToBottom()
    // 未结束的会议开始 30 秒轮询；已结束/已删除的是只读存档，不会再有新消息
    if (request === discussionRequest && !discussionReadOnly.value) {
      startDiscussionPolling()
    }
  } catch {
    // 请求拦截器已提示错误；讨论区是附加内容，失败不影响会议详情本身。
    // 但要如实告诉用户「加载失败」，而不是显示成「还没有人发言」（评审意见）。
    if (request === discussionRequest) {
      discussionLoadFailed.value = true
    }
  } finally {
    if (request === discussionRequest) {
      discussionLoading.value = false
    }
  }
}

/**
 * 轮询拉取讨论区新消息。
 *
 * 只在「会议未结束且未删除」时轮询——已结束的讨论区是只读存档，
 * 不会再有新消息，没必要空转。
 */
async function pollDiscussion(): Promise<void> {
  if (!detailVisible.value || discussionReadOnly.value) return
  const convId = discussionConversationId.value
  if (!convId) return

  const request = discussionRequest
  const list = await conversationsApi.fetchMessages(convId, 200).catch(() => null)
  // 序号对不上说明用户已经切到别的会议了，丢弃
  if (request !== discussionRequest || !list) return
  if (list.length === discussionMessages.value.length) return

  discussionMessages.value = list
  // 消息在**弹窗里已经看到了**，所以同样要标记已读——
  // 否则轮询把新消息拉进来，未读数却还挂着（消息页角标不消）。
  await conversationsApi.markRead(convId).catch(() => {
    // 已读失败不阻断；下次轮询还会再试
  })
  if (request !== discussionRequest) return
  // 用户没往上翻才滚到底部
  if (discussionPinnedToBottom.value) {
    await scrollDiscussionToBottom()
  }
}

/** 启动讨论区轮询定时器 */
function startDiscussionPolling(): void {
  stopDiscussionPolling()
  discussionTimer = setInterval(() => {
    void pollDiscussion()
  }, DISCUSSION_POLL_INTERVAL_MS)
}

/** 停掉讨论区轮询定时器（弹窗关闭、组件卸载、切换会议时都要停） */
function stopDiscussionPolling(): void {
  if (discussionTimer) {
    clearInterval(discussionTimer)
    discussionTimer = null
  }
}

async function scrollDiscussionToBottom(): Promise<void> {
  await nextTick()
  const el = discussionScrollRef.value
  if (el) el.scrollTop = el.scrollHeight
  discussionPinnedToBottom.value = true
}

/**
 * 待发送的附件（讨论区）。
 *
 * 只在内存里暂存，**不上传即选中**——避免用户选了个文件又取消，
 * 服务器上却留下一条没人引用的 file 记录（孤儿文件）。
 */
const discussionPendingFile = ref<File | undefined>()
const discussionUploadRef = ref<{ clearFiles: () => void } | undefined>()

function handleDiscussionFileChange(uploadFile: { raw?: File }): void {
  discussionPendingFile.value = uploadFile.raw
  // 清空内部列表：否则第二次选同一文件会被 limit 拦下
  discussionUploadRef.value?.clearFiles()
}

function handleDiscussionFileRemove(): void {
  discussionPendingFile.value = undefined
}

async function sendDiscussionMessage(): Promise<void> {
  const content = discussionDraft.value.trim()
  if (!content || !discussionConversationId.value || discussionSending.value) return
  if (discussionReadOnly.value) return
  discussionSending.value = true
  try {
    // 有附件时先传文件拿到 fileId，再带 fileId 发消息（两段式）
    let fileId: string | undefined
    if (discussionPendingFile.value) {
      const uploaded = await fileApi.uploadFile(discussionPendingFile.value)
      fileId = uploaded.id
    }
    const message = await conversationsApi.sendMessage(
      discussionConversationId.value,
      content,
      fileId
    )
    discussionMessages.value.push(message)
    discussionDraft.value = ''
    discussionPendingFile.value = undefined
    await scrollDiscussionToBottom()
  } catch {
    // 提示由拦截器统一处理。
    // 注意：附件已上传但发消息失败时**保留** discussionPendingFile 供重试，
    // 否则再点一次发送会重新上传一份，file 表里堆孤儿行。
  } finally {
    discussionSending.value = false
  }
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function dayMeetings(date: Date): MeetingItem[] {
  const key = dayKey(date)
  return meetings.value.filter((item) => item.heldAt.startsWith(key))
}

function changeMonth(offset: number): void {
  // 固定为 1 日，避免 29–31 日翻入小月时溢出、跳月或卡住。
  calendarMonth.value = new Date(
    calendarMonth.value.getFullYear(),
    calendarMonth.value.getMonth() + offset,
    1
  )
}

function statusLabel(status: MeetingItem['status']): string {
  if (status === 'upcoming') return '即将开始'
  if (status === 'ongoing') return '进行中'
  if (status === 'ended') return '已结束'
  return '未安排时间'
}

function statusTag(status: MeetingItem['status']): 'success' | 'warning' | 'info' {
  if (status === 'upcoming') return 'warning'
  if (status === 'ended') return 'info'
  return 'success'
}

function attendeeNames(meeting: MeetingItem): string {
  return meeting.attendees.map((item) => item.nickname || item.username).join('、') || '未指定'
}

async function loadProjects(): Promise<void> {
  const result = await projectsApi.fetchProjects({ page: 1, size: 100 })
  projects.value = result.list

  if (!projects.value.some((item) => item.id === currentProjectId.value)) {
    currentProjectId.value = projects.value[0]?.id ?? ''
  }

  if (currentProjectId.value) {
    await Promise.all([loadMeetings(), loadMembers()])
  }
}

async function loadMeetings(): Promise<void> {
  if (!currentProjectId.value) {
    meetings.value = []
    return
  }

  loading.value = true

  try {
    const all: MeetingItem[] = []
    let currentPage = 1

    while (true) {
      const result = await meetingsApi.fetchMeetings({
        projectId: currentProjectId.value,
        page: currentPage,
        size: 100
      })

      all.push(...result.list)

      if (result.list.length < 100 || all.length >= result.total) {
        break
      }

      currentPage += 1
    }

    meetings.value = all
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(filteredMeetings.value.length / pageSize))
    )

    if (!calendarDate.value) {
      calendarDate.value = dayKey(new Date())
    }
  } finally {
    loading.value = false
  }
}

async function loadMembers(): Promise<void> {
  if (!currentProjectId.value) {
    teamMembers.value = []
    return
  }

  const project = await projectsApi.fetchProject(currentProjectId.value)
  const result = await teamsApi.fetchTeamMembers(project.teamId, {
    page: 1,
    size: 100
  })

  teamMembers.value = result.list
}

function handleProjectChange(): void {
  page.value = 1
  void Promise.all([loadMeetings(), loadMembers()])
}

function handleTabChange(): void {
  page.value = 1
}

function handlePageChange(value: number): void {
  page.value = value
}

function openCreate(): void {
  dialogMode.value = 'create'
  editingId.value = ''

  Object.assign(form, {
    title: '',
    heldAt: '',
    location: '',
    content: '',
    attendeeIds: []
  })

  dialogVisible.value = true
}

function openEdit(row: MeetingItem): void {
  dialogMode.value = 'edit'
  editingId.value = row.id

  Object.assign(form, {
    title: row.title,
    heldAt: row.heldAt,
    location: row.location,
    content: row.content,
    attendeeIds: row.attendees.map((item) => item.userId)
  })

  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  dialogLoading.value = true

  try {
    if (dialogMode.value === 'create') {
      await meetingsApi.createMeeting({
        projectId: currentProjectId.value,
        title: form.title.trim(),
        heldAt: form.heldAt || undefined,
        location: form.location.trim() || undefined,
        content: form.content || undefined,
        attendeeIds: form.attendeeIds
      })

      ElMessage.success('会议已创建；安排了开始时间的会议会在开始前一小时内提醒参会人')
    } else {
      await meetingsApi.updateMeeting(editingId.value, {
        title: form.title.trim(),
        heldAt: form.heldAt || undefined,
        location: form.location.trim(),
        content: form.content,
        attendeeIds: form.attendeeIds
      })

      ElMessage.success('会议已更新')
    }

    dialogVisible.value = false
    await loadMeetings()
  } catch {
    // 请求失败由拦截器统一提示；保留表单供修改或重试。
  } finally {
    dialogLoading.value = false
  }
}

async function removeMeeting(row: MeetingItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确定删除会议“${row.title}”吗？参会记录不会撤销。`,
    '删除会议',
    {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    }
  ).catch(() => false)

  if (!confirmed) return

  await meetingsApi.deleteMeeting(row.id)
  ElMessage.success('会议已删除')
  await loadMeetings()
}

let detailRequest = 0

async function openDetail(row: Pick<MeetingItem, 'id'>): Promise<void> {
  const request = ++detailRequest
  detail.value = null
  detailVisible.value = true
  detailLoading.value = true
  // 切换会议时先停掉上一场的轮询，避免旧会议的定时器继续拉数据
  stopDiscussionPolling()

  try {
    const result = await meetingsApi.fetchMeeting(row.id)
    if (request === detailRequest) detail.value = result
    // 讨论区与详情并行加载；失败不阻断详情展示
    void loadDiscussion(row.id)
  } catch {
    // 请求拦截器已提示 403/404 等错误；不要留下空详情或上一次会议的内容。
    if (request === detailRequest) detailVisible.value = false
  } finally {
    if (request === detailRequest) detailLoading.value = false
  }
}

async function openMeetingFromQuery(): Promise<void> {
  const meetingId = route.query.meetingId
  if (typeof meetingId !== 'string' || !meetingId) return

  const row = meetings.value.find((item) => item.id === meetingId)
  // 通知可能指向其他项目，不能只在当前项目列表中查找。
  await openDetail(row ?? { id: meetingId })
}

function handleDetailClosed(): void {
  // 弹窗关闭：停掉轮询定时器，并让在途的讨论区请求作废
  // （否则关闭后 A 的响应回来会把已清空的讨论区重新填上）
  stopDiscussionPolling()
  discussionRequest += 1
  discussionLoading.value = false

  // Element Plus 的 closed 先于 update:modelValue=false，不能依赖旧的可见值。
  if (route.query.meetingId === undefined) return
  // 消费完深链接后清理参数，同一条提醒再次点击也能触发路由变化。
  const query = { ...route.query }
  delete query.meetingId
  void router.replace({ query })
}

watch(
  () => route.query.meetingId,
  () => {
    void openMeetingFromQuery()
  }
)

onMounted(async () => {
  await loadProjects()
  await openMeetingFromQuery()
})

onBeforeUnmount(() => {
  // 组件卸载必须停掉定时器，否则路由切走后定时器还在拉数据
  stopDiscussionPolling()
})
</script>

<template>
  <div class="meetings-page">
    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <el-select
            v-model="currentProjectId"
            class="project-select"
            placeholder="选择项目"
            :disabled="projects.length === 0"
            @change="handleProjectChange"
          >
            <el-option
              v-for="project in projects"
              :key="project.id"
              :label="project.name"
              :value="project.id"
            />
          </el-select>

          <span v-if="currentProject" class="project-meta">
            {{ currentProject.name }}
          </span>

          <el-button type="primary" :disabled="!currentProjectId" @click="openCreate">
            创建会议
          </el-button>
        </div>
      </template>

      <el-empty v-if="projects.length === 0" description="还没有项目">
        <p class="empty-hint">会议必须挂在项目下，请先到“项目管理”创建项目。</p>
      </el-empty>

      <template v-else>
        <el-tabs v-model="activeTab" @tab-change="handleTabChange">
          <el-tab-pane label="未结束" name="upcoming" />
          <el-tab-pane label="已结束" name="ended" />
          <el-tab-pane label="全部" name="all" />
        </el-tabs>

        <el-table v-loading="loading" :data="pagedMeetings" empty-text="暂无会议">
          <el-table-column label="主题" min-width="190">
            <template #default="{ row }">
              <span class="meeting-title">{{ row.title }}</span>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTag(row.status)" size="small">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="heldAt" label="开始时间" width="170" />

          <el-table-column prop="location" label="地点/线上链接" min-width="150" />

          <el-table-column label="参会人" min-width="160">
            <template #default="{ row }">
              {{ attendeeNames(row) }}
            </template>
          </el-table-column>

          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="removeMeeting(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pager">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="filteredMeetings.length"
            :page-size="pageSize"
            :current-page="page"
            @current-change="handlePageChange"
          />
        </div>
      </template>
    </el-card>

    <el-card shadow="never" class="calendar-card">
      <template #header>
        <div class="calendar-head">
          <el-button text @click="changeMonth(-1)">‹</el-button>
          <strong>{{ monthLabel }}</strong>
          <el-button text @click="changeMonth(1)">›</el-button>
        </div>
      </template>

      <div class="calendar-grid calendar-week">
        <span v-for="day in ['日', '一', '二', '三', '四', '五', '六']" :key="day">
          {{ day }}
        </span>
      </div>

      <div class="calendar-grid">
        <button
          v-for="date in calendarDays"
          :key="dayKey(date)"
          class="calendar-day"
          :class="{
            muted: date.getMonth() !== calendarMonth.getMonth(),
            selected: dayKey(date) === calendarDate
          }"
          @click="calendarDate = dayKey(date)"
        >
          <span>{{ date.getDate() }}</span>
          <i v-if="dayMeetings(date).length" />
        </button>
      </div>

      <div v-if="calendarDate" class="calendar-events">
        <strong>{{ calendarDate }}</strong>

        <el-button
          v-for="meeting in selectedCalendarMeetings"
          :key="meeting.id"
          link
          type="primary"
          @click="openDetail(meeting)"
        >
          {{ meeting.heldAt.slice(11, 16) }} {{ meeting.title }}
        </el-button>

        <span v-if="selectedCalendarMeetings.length === 0" class="muted">当天没有会议</span>
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '创建会议' : '编辑会议'"
      width="560px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="所属项目">
          <span>{{ currentProject?.name }}</span>
        </el-form-item>

        <el-form-item label="主题" prop="title">
          <el-input v-model="form.title" maxlength="200" />
        </el-form-item>

        <el-form-item label="开始时间">
          <el-date-picker
            v-model="form.heldAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
            class="full-width"
            placeholder="选填，未填表示暂不安排时间"
          />
        </el-form-item>

        <el-form-item label="地点/链接" prop="location">
          <el-input
            v-model="form.location"
            maxlength="200"
            placeholder="选填，教室或线上会议链接"
          />
        </el-form-item>

        <el-form-item label="参会人">
          <el-select
            v-model="form.attendeeIds"
            multiple
            filterable
            class="full-width"
            placeholder="选填，选择参会人"
          >
            <el-option
              v-for="member in teamMembers"
              :key="member.userId"
              :label="`${member.nickname || member.username}（@${member.username}）`"
              :value="member.userId"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="会议记录">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="4"
            maxlength="20000"
            placeholder="选填，记录会议内容"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="会议详情" width="680px" @closed="handleDetailClosed">
      <div v-loading="detailLoading" class="meeting-detail">
        <template v-if="detail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="主题" :span="2">
              {{ detail.title }}
            </el-descriptions-item>

            <el-descriptions-item label="所属项目">
              {{ detail.projectName }}
            </el-descriptions-item>

            <el-descriptions-item label="开始时间">
              {{ detail.heldAt || '未安排' }}
            </el-descriptions-item>

            <el-descriptions-item label="状态">
              <el-tag :type="statusTag(detail.status)">
                {{ statusLabel(detail.status) }}
              </el-tag>
            </el-descriptions-item>

            <el-descriptions-item label="地点/链接" :span="2">
              {{ detail.location || '—' }}
            </el-descriptions-item>

            <el-descriptions-item label="创建时间" :span="2">
              {{ detail.createdAt }}
            </el-descriptions-item>

            <el-descriptions-item label="会议记录" :span="2">
              <span class="content-text">{{ detail.content || '—' }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <template v-if="detail.attendees.length > 0">
            <p class="members-title">参会人（{{ detail.attendees.length }} 人）</p>

            <el-table :data="detail.attendees" size="small">
              <el-table-column label="成员" min-width="160">
                <template #default="{ row }">
                  {{ row.nickname || row.username }}
                  <span class="muted">@{{ row.username }}</span>
                </template>
              </el-table-column>

              <el-table-column prop="email" label="邮箱" min-width="200" />
            </el-table>
          </template>

          <!-- 讨论区（线③ 卡 F-1） -->
          <div class="discussion">
            <p class="members-title">
              讨论区
              <el-tag v-if="discussionReadOnly" size="small" type="info" effect="plain">
                {{ discussionReadOnlyReason || '会议已结束，只读' }}
              </el-tag>
            </p>

            <div
              ref="discussionScrollRef"
              v-loading="discussionLoading"
              class="discussion-scroll"
              @scroll="handleDiscussionScroll"
            >
              <!-- 加载失败与「没有人发言」要区分开：
                   失败时显示「加载失败」，否则用户会以为是空会话（评审意见） -->
              <el-empty
                v-if="discussionLoadFailed"
                description="讨论区加载失败，请关闭后重试"
                :image-size="50"
              />
              <el-empty
                v-else-if="discussionMessages.length === 0 && !discussionLoading"
                description="还没有人发言"
                :image-size="50"
              />
              <div
                v-for="msg in discussionMessages"
                :key="msg.id"
                class="discussion-msg"
              >
                <span class="discussion-sender">{{ msg.senderName }}</span>
                <span class="discussion-text">{{ msg.content }}</span>
                <!-- 文件消息（线③ 收尾）：附件卡片；附件被删除时后端不下发 file，降级为纯文本 -->
                <a
                  v-if="msg.msgType === 'file' && msg.file"
                  class="discussion-file"
                  :href="msg.file.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :download="msg.file.originalName"
                >
                  <span class="discussion-file-icon" aria-hidden="true">📎</span>
                  <span class="discussion-file-name">{{ msg.file.originalName }}</span>
                  <span class="discussion-file-size">{{ formatFileSize(msg.file.size) }}</span>
                </a>
                <span class="discussion-time">{{ msg.createdAt }}</span>
              </div>
            </div>

            <div class="discussion-input">
              <!-- 待发送的附件：显示在输入框上方，点发送才真正上传 -->
              <div v-if="discussionPendingFile" class="discussion-pending-file">
                <span class="discussion-file-icon" aria-hidden="true">📎</span>
                <span class="discussion-file-name">{{ discussionPendingFile.name }}</span>
                <span class="discussion-file-size">
                  {{ formatFileSize(discussionPendingFile.size) }}
                </span>
                <el-button link type="danger" @click="handleDiscussionFileRemove">移除</el-button>
              </div>
              <el-input
                v-model="discussionDraft"
                type="textarea"
                :rows="2"
                maxlength="2000"
                :disabled="discussionReadOnly"
                :placeholder="
                  discussionReadOnly
                    ? discussionReadOnlyReason || '讨论区只读'
                    : '在讨论区发言，Enter 发送，Shift+Enter 换行'
                "
                @keydown.enter.exact.prevent="sendDiscussionMessage"
              />
              <el-upload
                ref="discussionUploadRef"
                class="discussion-upload"
                :auto-upload="false"
                :show-file-list="false"
                :on-change="handleDiscussionFileChange"
              >
                <el-button :disabled="discussionReadOnly || !discussionConversationId">
                  <span aria-hidden="true">📎</span>
                  <span class="discussion-upload-text">附件</span>
                </el-button>
              </el-upload>
              <el-button
                type="primary"
                :loading="discussionSending"
                :disabled="!discussionDraft.trim() || discussionReadOnly || !discussionConversationId"
                @click="sendDiscussionMessage"
              >
                发送
              </el-button>
            </div>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.meetings-page {
  display: grid;
  gap: 16px;
}

.toolbar,
.calendar-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar .project-select {
  width: 260px;
  margin-right: auto;
}

.project-meta,
.muted {
  color: #909399;
  font-size: 12px;
}

.empty-hint {
  margin: 4px 0 0;
  color: #909399;
  font-size: 13px;
}

.meeting-title {
  font-weight: 600;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.calendar-card {
  max-width: 860px;
}

.calendar-head {
  justify-content: center;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.calendar-week {
  margin-bottom: 4px;
  color: #909399;
  font-size: 12px;
  text-align: center;
}

.calendar-day {
  min-height: 42px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #303133;
  cursor: pointer;
}

.calendar-day:hover,
.calendar-day.selected {
  background: #ecf5ff;
}

.calendar-day.muted {
  color: #c0c4cc;
}

.calendar-day i {
  display: block;
  width: 5px;
  height: 5px;
  margin: 3px auto 0;
  border-radius: 50%;
  background: #409eff;
}

.calendar-events {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #ebeef5;
}

.full-width {
  width: 100%;
}

.meeting-detail {
  display: grid;
  gap: 14px;
  min-height: 120px;
}

.members-title {
  margin: 0 0 8px;
  color: #606266;
  font-size: 13px;
}

/* 讨论区（线③ 卡 F-1） */
.discussion {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.discussion-scroll {
  max-height: 260px;
  overflow-y: auto;
  padding: 8px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.discussion-msg {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.discussion-sender {
  color: #409eff;
  flex-shrink: 0;
}

.discussion-text {
  flex: 1;
  color: #303133;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.discussion-time {
  color: #c0c4cc;
  font-size: 11px;
  flex-shrink: 0;
}

.discussion-input {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  align-items: flex-end;
  flex-wrap: wrap;
}

/* 讨论区里的附件卡片（线③ 收尾） */
.discussion-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  color: #409eff;
  text-decoration: none;
  font-size: 12px;
  max-width: 100%;
}

.discussion-file:hover {
  border-color: #409eff;
}

.discussion-file-icon {
  font-size: 13px;
}

.discussion-file-name {
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.discussion-file-size {
  color: #909399;
  font-size: 11px;
  flex-shrink: 0;
}

.discussion-pending-file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 0;
  font-size: 12px;
}

.discussion-pending-file .discussion-file-name {
  color: #303133;
}

.discussion-upload-text {
  margin-left: 4px;
}

.content-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
