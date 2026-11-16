<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { meetingsApi, projectsApi, teamsApi } from '@/api'
import type { MeetingItem } from '@/api/meetings'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'

// ---------------------------------------------------------------- 项目上下文与列表

const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const currentProject = computed(() =>
  projects.value.find((p) => p.id === currentProjectId.value)
)

const list = ref<MeetingItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)

/** 参会人选择器数据源：当前项目所属课题组成员（与任务负责人/成果参与人同源） */
const teamMembers = ref<TeamMemberItem[]>([])

async function loadProjects(): Promise<void> {
  const result = await projectsApi.fetchProjects({ page: 1, size: 100 })
  projects.value = result.list
  if (!projects.value.some((p) => p.id === currentProjectId.value)) {
    currentProjectId.value = projects.value[0]?.id ?? ''
    page.value = 1
  }
  if (currentProjectId.value) {
    await Promise.all([loadList(), loadMembers()])
  } else {
    list.value = []
    total.value = 0
  }
}

async function loadList(): Promise<void> {
  if (!currentProjectId.value) return
  loading.value = true
  try {
    const result = await meetingsApi.fetchMeetings({
      projectId: currentProjectId.value,
      page: page.value,
      size: size.value
    })
    list.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

async function loadMembers(): Promise<void> {
  if (!currentProjectId.value) return
  const info = await projectsApi.fetchProject(currentProjectId.value)
  const team = await teamsApi.fetchTeamMembers(info.teamId, { page: 1, size: 100 })
  teamMembers.value = team.list
}

function handleProjectChange(): void {
  page.value = 1
  void loadList()
  void loadMembers()
}

function handlePageChange(next: number): void {
  page.value = next
  void loadList()
}

// ---------------------------------------------------------------- 新建 / 编辑

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

function openCreate(): void {
  dialogMode.value = 'create'
  editingId.value = ''
  form.title = ''
  form.heldAt = ''
  form.location = ''
  form.content = ''
  form.attendeeIds = []
  dialogVisible.value = true
}

function openEdit(row: MeetingItem): void {
  dialogMode.value = 'edit'
  editingId.value = row.id
  form.title = row.title
  form.heldAt = row.heldAt
  form.location = row.location
  form.content = row.content
  form.attendeeIds = row.attendees.map((a) => a.userId)
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
        attendeeIds: form.attendeeIds.length > 0 ? form.attendeeIds : undefined
      })
      ElMessage.success('会议已登记')
      page.value = 1
    } else {
      await meetingsApi.updateMeeting(editingId.value, {
        title: form.title.trim(),
        // 后端 heldAt 的 DTO 用正则校验、不接受空串清空，未选时间就不传该字段
        heldAt: form.heldAt || undefined,
        location: form.location.trim(),
        content: form.content,
        attendeeIds: form.attendeeIds
      })
      ElMessage.success('会议已更新')
    }
    dialogVisible.value = false
    await loadList()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    dialogLoading.value = false
  }
}

// ---------------------------------------------------------------- 详情 / 删除

const detailVisible = ref(false)
const detail = ref<MeetingItem | null>(null)
const detailLoading = ref(false)

async function openDetail(row: MeetingItem): Promise<void> {
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await meetingsApi.fetchMeeting(row.id)
  } finally {
    detailLoading.value = false
  }
}

async function handleRemove(row: MeetingItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除后不可恢复；按参与度口径，已产生的会议与参会记录不会撤销。是否删除「${row.title}」？`,
    '删除会议',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await meetingsApi.deleteMeeting(row.id)
  ElMessage.success('已删除')
  // 删掉当前页最后一条时回退一页，避免停在空页
  if (list.value.length === 1 && page.value > 1) {
    page.value -= 1
  }
  await loadList()
}

onMounted(() => {
  void loadProjects()
})
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="toolbar">
        <el-select
          v-model="currentProjectId"
          placeholder="选择项目"
          class="project-select"
          :disabled="projects.length === 0"
          @change="handleProjectChange"
        >
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <span v-if="currentProject" class="project-meta">{{ currentProject.name }}</span>
        <div class="toolbar-actions">
          <el-button
            type="primary"
            :disabled="!currentProjectId"
            @click="openCreate()"
          >
            登记会议
          </el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="projects.length === 0" description="还没有项目">
      <p class="empty-hint">会议必须挂在项目下，请先到「项目管理」创建项目</p>
    </el-empty>

    <template v-else>
      <el-table v-loading="loading" :data="list">
        <el-table-column label="会议主题" min-width="200">
          <template #default="{ row }">
            <span class="meeting-title">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="projectName" label="所属项目" min-width="130" />
        <el-table-column label="召开时间" width="170">
          <template #default="{ row }">
            <span v-if="row.heldAt">{{ row.heldAt }}</span>
            <span v-else class="muted">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="地点" min-width="140">
          <template #default="{ row }">
            <span v-if="row.location">{{ row.location }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="参会人" min-width="170">
          <template #default="{ row }">
            <template v-if="row.attendees.length > 0">
              <span v-for="a in row.attendees" :key="a.userId" class="member-chip">
                {{ a.nickname || a.username }}
              </span>
            </template>
            <span v-else class="muted">未记录</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleRemove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="total, prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="page"
          @current-change="handlePageChange"
        />
      </div>
    </template>

    <!-- 登记 / 编辑会议 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '登记会议' : '编辑会议'"
      width="560px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="所属项目" v-if="dialogMode === 'create'">
          <span>{{ currentProject?.name }}</span>
        </el-form-item>
        <el-form-item label="主题" prop="title">
          <el-input v-model="form.title" maxlength="200" placeholder="如：需求评审会（第 3 周）" />
        </el-form-item>
        <el-form-item label="召开时间">
          <el-date-picker
            v-model="form.heldAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="选填"
            class="full-width"
          />
        </el-form-item>
        <el-form-item label="地点" prop="location">
          <el-input v-model="form.location" maxlength="200" placeholder="会议室或线上会议链接，选填" />
        </el-form-item>
        <el-form-item label="参会人">
          <el-select
            v-model="form.attendeeIds"
            multiple
            filterable
            class="full-width"
            placeholder="选择课题组成员，选填"
          >
            <el-option
              v-for="m in teamMembers"
              :key="m.userId"
              :label="`${m.nickname || m.username}（@${m.username}）`"
              :value="m.userId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="会议记录">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            maxlength="20000"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleSubmit">
          {{ dialogMode === 'create' ? '登记' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 会议详情 -->
    <el-dialog v-model="detailVisible" title="会议详情" width="640px">
      <div v-loading="detailLoading">
        <el-descriptions v-if="detail" :column="2" border>
          <el-descriptions-item label="主题" :span="2">{{ detail.title }}</el-descriptions-item>
          <el-descriptions-item label="所属项目">{{ detail.projectName }}</el-descriptions-item>
          <el-descriptions-item label="召开时间">{{ detail.heldAt || '未设置' }}</el-descriptions-item>
          <el-descriptions-item label="地点" :span="2">{{ detail.location || '—' }}</el-descriptions-item>
          <el-descriptions-item label="登记时间" :span="2">{{ detail.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="会议记录" :span="2">
            <span class="content-text">{{ detail.content || '—' }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="detail && detail.attendees.length > 0">
          <p class="members-title">参会人（{{ detail.attendees.length }} 人）</p>
          <el-table :data="detail.attendees" size="small">
            <el-table-column label="成员" min-width="140">
              <template #default="{ row }">
                {{ row.nickname || row.username }}
                <span class="muted">@{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" min-width="180" />
          </el-table>
        </template>
      </div>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-select {
  width: 260px;
}

.project-meta {
  font-size: 13px;
  color: #909399;
}

.toolbar-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.meeting-title {
  font-weight: 500;
  color: #303133;
}

.member-chip {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 1px 8px;
  font-size: 12px;
  color: #606266;
  background: #f4f4f5;
  border-radius: 9px;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.full-width {
  width: 100%;
}

.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.members-title {
  margin: 16px 0 8px;
  font-size: 13px;
  color: #606266;
}

.content-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
