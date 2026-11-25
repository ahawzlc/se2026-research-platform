<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { meetingsApi, projectsApi, teamsApi } from '@/api'
import type { MeetingItem } from '@/api/meetings'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'

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

  try {
    const result = await meetingsApi.fetchMeeting(row.id)
    if (request === detailRequest) detail.value = result
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

.content-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
