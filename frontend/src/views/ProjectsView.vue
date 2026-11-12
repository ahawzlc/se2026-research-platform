<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { projectsApi, teamsApi } from '@/api'
import type {
  MilestoneItem,
  MilestoneStatus,
  ProjectDetail,
  ProjectItem,
  ProjectMemberItem,
  ProjectStatus
} from '@/api/projects'
import type { MyTeamItem } from '@/api/teams'

/** 项目状态中文名与配色 */
const STATUS_META: Record<ProjectStatus, { label: string; type: 'info' | 'primary' | 'success' | 'warning' }> = {
  planning: { label: '规划中', type: 'info' },
  active: { label: '进行中', type: 'primary' },
  finished: { label: '已完成', type: 'success' },
  archived: { label: '已归档', type: 'warning' }
}

// ---------------------------------------------------------------- 列表

const route = useRoute()
const projects = ref<ProjectItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const statusFilter = ref<ProjectStatus | ''>('')

async function loadProjects(): Promise<void> {
  loading.value = true
  try {
    const result = await projectsApi.fetchProjects({
      page: page.value,
      size: size.value,
      status: statusFilter.value || undefined,
      keyword: keyword.value.trim() || undefined
    })
    projects.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function handleSearch(): void {
  page.value = 1
  void loadProjects()
}

function handlePageChange(next: number): void {
  page.value = next
  void loadProjects()
}

// ---------------------------------------------------------------- 表单

const formVisible = ref(false)
const formLoading = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref('')
const teams = ref<MyTeamItem[]>([])

const form = reactive({
  name: '',
  description: '',
  teamId: '',
  status: 'planning' as ProjectStatus,
  startDate: '',
  endDate: ''
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { max: 100, message: '名称最长 100 个字符', trigger: 'blur' }
  ]
}

function openCreate(): void {
  editingId.value = ''
  form.name = ''
  form.description = ''
  form.teamId = teams.value[0]?.id ?? ''
  form.status = 'planning'
  form.startDate = ''
  form.endDate = ''
  formVisible.value = true
}

function openEdit(row: ProjectItem): void {
  editingId.value = row.id
  form.name = row.name
  form.description = row.description
  form.teamId = row.teamId
  form.status = row.status
  form.startDate = row.startDate
  form.endDate = row.endDate
  formVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  const payload = {
    name: form.name,
    description: form.description || undefined,
    status: form.status,
    startDate: form.startDate || undefined,
    endDate: form.endDate || undefined
  }

  formLoading.value = true
  try {
    if (editingId.value) {
      await projectsApi.updateProject(editingId.value, payload)
      ElMessage.success('项目已更新')
    } else {
      await projectsApi.createProject({ ...payload, teamId: form.teamId || undefined })
      ElMessage.success('项目已创建')
    }
    formVisible.value = false
    await loadProjects()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    formLoading.value = false
  }
}

async function handleDelete(row: ProjectItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除项目「${row.name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await projectsApi.deleteProject(row.id)
    ElMessage.success('项目已删除')
    await loadProjects()
  } catch {
    // 提示由拦截器统一处理
  }
}

// ---------------------------------------------------------------- 详情抽屉

const detailVisible = ref(false)
const detail = ref<ProjectDetail | null>(null)
const detailLoading = ref(false)

async function openDetail(row: ProjectItem): Promise<void> {
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await projectsApi.fetchProject(row.id)
  } catch {
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

// ---------------------------------------------------------------- 里程碑

const milestoneVisible = ref(false)
const milestoneLoading = ref(false)
const milestoneFormVisible = ref(false)
const milestoneFormRef = ref<FormInstance>()
const milestoneProjectId = ref('')
const milestones = ref<MilestoneItem[]>([])
const milestoneEditingId = ref('')

const milestoneForm = reactive({
  name: '',
  dueDate: '',
  status: 'pending' as MilestoneStatus
})

const milestoneRules: FormRules = {
  name: [{ required: true, message: '请输入里程碑名称', trigger: 'blur' }]
}

async function openMilestones(projectId: string): Promise<void> {
  milestoneProjectId.value = projectId
  milestoneVisible.value = true
  await loadMilestones()
}

async function loadMilestones(): Promise<void> {
  if (!milestoneProjectId.value) return
  milestoneLoading.value = true
  try {
    milestones.value = await projectsApi.fetchMilestones(milestoneProjectId.value)
  } finally {
    milestoneLoading.value = false
  }
}

function openMilestoneCreate(): void {
  milestoneEditingId.value = ''
  milestoneForm.name = ''
  milestoneForm.dueDate = ''
  milestoneForm.status = 'pending'
  milestoneFormVisible.value = true
}

function openMilestoneEdit(row: MilestoneItem): void {
  milestoneEditingId.value = row.id
  milestoneForm.name = row.name
  milestoneForm.dueDate = row.dueDate
  milestoneForm.status = row.status
  milestoneFormVisible.value = true
}

async function handleMilestoneSubmit(): Promise<void> {
  if (!milestoneFormRef.value) return
  const valid = await milestoneFormRef.value.validate().catch(() => false)
  if (!valid) return

  milestoneLoading.value = true
  try {
    if (milestoneEditingId.value) {
      await projectsApi.updateMilestone(milestoneEditingId.value, {
        name: milestoneForm.name,
        dueDate: milestoneForm.dueDate || undefined,
        status: milestoneForm.status
      })
      ElMessage.success('里程碑已更新')
    } else {
      await projectsApi.createMilestone({
        projectId: milestoneProjectId.value,
        name: milestoneForm.name,
        dueDate: milestoneForm.dueDate || undefined
      })
      ElMessage.success('里程碑已创建')
    }
    milestoneFormVisible.value = false
    await loadMilestones()
    await loadProjects()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    milestoneLoading.value = false
  }
}

/** 快速切换里程碑完成状态（后端在此写 milestone_done 埋点） */
async function toggleMilestone(row: MilestoneItem): Promise<void> {
  const next: MilestoneStatus = row.status === 'done' ? 'pending' : 'done'
  try {
    await projectsApi.updateMilestone(row.id, { status: next })
    row.status = next
    await loadMilestones()
    await loadProjects()
  } catch {
    await loadMilestones()
  }
}

async function handleMilestoneDelete(row: MilestoneItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除里程碑「${row.name}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await projectsApi.deleteMilestone(row.id)
    ElMessage.success('里程碑已删除')
    await loadMilestones()
    await loadProjects()
  } catch {
    // 提示由拦截器统一处理
  }
}

// ---------------------------------------------------------------- 成员

const memberVisible = ref(false)
const memberDialogVisible = ref(false)
const memberLoading = ref(false)
const projectMembers = ref<ProjectMemberItem[]>([])
const teamMembers = ref<ProjectMemberItem[]>([])
const memberProjectId = ref('')
const memberTarget = ref('')

async function openMembers(projectId: string): Promise<void> {
  memberProjectId.value = projectId
  memberVisible.value = true
  memberLoading.value = true
  try {
    const [pm, tm] = await Promise.all([
      projectsApi.fetchProjectMembers(projectId),
      teamsApi.fetchTeamMembers(await resolveTeamId(projectId))
    ])
    projectMembers.value = pm
    teamMembers.value = tm.list
  } catch {
    projectMembers.value = []
    teamMembers.value = []
  } finally {
    memberLoading.value = false
  }
}

/** 取项目所属课题组 id：先取详情再取其 teamId */
async function resolveTeamId(projectId: string): Promise<string> {
  const info = await projectsApi.fetchProject(projectId)
  return info.teamId
}

/** 可添加的成员 = 组内成员 − 已在项目中的人 */
const addableMembers = computed(() => {
  const joined = new Set(projectMembers.value.map((m) => m.userId))
  return teamMembers.value.filter((m) => !joined.has(m.userId))
})

async function handleAddMember(): Promise<void> {
  if (!memberTarget.value) {
    ElMessage.warning('请先选择要添加的成员')
    return
  }
  memberLoading.value = true
  try {
    await projectsApi.addProjectMember(memberProjectId.value, memberTarget.value)
    ElMessage.success('成员已添加')
    memberTarget.value = ''
    memberDialogVisible.value = false
    await openMembers(memberProjectId.value)
  } catch {
    // 提示由拦截器统一处理
  } finally {
    memberLoading.value = false
  }
}

async function handleRemoveMember(member: ProjectMemberItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定将「${member.nickname || member.username}」移出项目吗？`, '移除确认', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await projectsApi.removeProjectMember(memberProjectId.value, member.userId)
    ElMessage.success('成员已移除')
    await openMembers(memberProjectId.value)
  } catch {
    // 提示由拦截器统一处理
  }
}

onMounted(async () => {
  teams.value = await teamsApi.fetchMyTeams()
  await loadProjects()
  const projectId = route.query.projectId
  if (typeof projectId === 'string' && typeof route.query.milestoneId === 'string')
    await openMilestones(projectId).catch(() => { milestoneVisible.value = false })
})
</script>

<template>
  <div class="projects-page">
    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="搜索项目名称"
            clearable
            class="search-input"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <el-select v-model="statusFilter" placeholder="全部状态" clearable class="status-select" @change="handleSearch">
            <el-option v-for="(meta, key) in STATUS_META" :key="key" :label="meta.label" :value="key" />
          </el-select>
          <el-button @click="handleSearch">查询</el-button>
          <el-button type="primary" class="toolbar-primary" @click="openCreate">新建项目</el-button>
        </div>
      </template>

      <el-empty v-if="projects.length === 0 && !loading" description="还没有项目">
        <p class="empty-hint">点击「新建项目」创建第一个项目，随后即可在其中建里程碑与任务</p>
      </el-empty>

      <template v-else>
        <el-table v-loading="loading" :data="projects">
          <el-table-column label="项目名称" min-width="200">
            <template #default="{ row }">
              <a class="project-name" @click="openDetail(row)">{{ row.name }}</a>
              <p class="project-desc">{{ row.description || '暂无简介' }}</p>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_META[row.status as ProjectStatus]?.type ?? 'info'" size="small">
                {{ STATUS_META[row.status as ProjectStatus]?.label ?? row.status }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="周期" width="180">
            <template #default="{ row }">
              <span class="date-text">{{ row.startDate || '未定' }} ~ {{ row.endDate || '未定' }}</span>
            </template>
          </el-table-column>

          <el-table-column label="里程碑" width="120">
            <template #default="{ row }">
              <el-progress
                :percentage="row.milestoneTotal ? Math.round((row.milestoneDone / row.milestoneTotal) * 100) : 0"
                :stroke-width="8"
                :format="() => `${row.milestoneDone}/${row.milestoneTotal}`"
              />
            </template>
          </el-table-column>

          <el-table-column label="任务" width="150">
            <template #default="{ row }">
              <div class="task-counts">
                <el-tag size="small" type="info">待办 {{ row.taskTodo }}</el-tag>
                <el-tag size="small" type="warning">进行 {{ row.taskDoing }}</el-tag>
                <el-tag size="small" type="success">完成 {{ row.taskDone }}</el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="成员" width="80" align="center">
            <template #default="{ row }">{{ row.memberCount }}</template>
          </el-table-column>

          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link type="primary" @click="openMilestones(row.id)">里程碑</el-button>
              <el-button link type="primary" @click="openMembers(row.id)">成员</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
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
    </el-card>

    <!-- 新建 / 编辑项目 -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑项目' : '新建项目'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="100" placeholder="如：智能感知实验平台" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="所属课题组">
          <el-select v-model="form.teamId" placeholder="选择课题组" class="full-width">
            <el-option v-for="team in teams" :key="team.id" :label="team.name" :value="team.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" class="full-width">
            <el-option v-for="(meta, key) in STATUS_META" :key="key" :label="meta.label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始日期">
          <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="full-width" />
        </el-form-item>
        <el-form-item label="结束日期">
          <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="full-width" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formLoading" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 项目详情 -->
    <el-drawer v-model="detailVisible" :title="detail?.name ?? '项目详情'" size="480px">
      <el-skeleton v-if="detailLoading" :rows="5" animated />
      <template v-else-if="detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="状态">
            <el-tag :type="STATUS_META[detail.status]?.type ?? 'info'" size="small">
              {{ STATUS_META[detail.status]?.label ?? detail.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="周期">
            {{ detail.startDate || '未定' }} ~ {{ detail.endDate || '未定' }}
          </el-descriptions-item>
          <el-descriptions-item label="里程碑">
            {{ detail.milestoneDone }} / {{ detail.milestoneTotal }} 已完成
          </el-descriptions-item>
          <el-descriptions-item label="任务">
            待办 {{ detail.taskTodo }} · 进行 {{ detail.taskDoing }} · 完成 {{ detail.taskDone }}
          </el-descriptions-item>
          <el-descriptions-item label="简介">{{ detail.description || '暂无' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ detail.createdAt }}</el-descriptions-item>
        </el-descriptions>
        <el-button link type="primary" class="drawer-title"
          @click="$router.push({ name: 'contribution', query: { teamId: detail.teamId } })">
          查看课题组参与度
        </el-button>

        <h4 class="drawer-title">项目成员</h4>
        <el-empty v-if="detail.members.length === 0" description="暂无成员" :image-size="60" />
        <div v-else class="member-list">
          <div v-for="member in detail.members" :key="member.userId" class="member-row">
            <span>{{ member.nickname || member.username }}</span>
            <span class="member-username">@{{ member.username }}</span>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 里程碑管理 -->
    <el-dialog v-model="milestoneVisible" title="里程碑管理" width="640px">
      <div class="milestone-toolbar">
        <el-button type="primary" @click="openMilestoneCreate">新建里程碑</el-button>
      </div>
      <el-table v-loading="milestoneLoading" :data="milestones"
        :row-class-name="({ row }: { row: MilestoneItem }) => row.id === route.query.milestoneId ? 'milestone-linked' : ''">
        <el-table-column label="名称" prop="name" min-width="160" />
        <el-table-column label="截止日期" width="120">
          <template #default="{ row }">{{ row.dueDate || '未定' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'done' ? 'success' : 'info'" size="small">
              {{ row.status === 'done' ? '已完成' : '进行中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button link type="primary" @click="toggleMilestone(row)">
              {{ row.status === 'done' ? '撤销完成' : '标记完成' }}
            </el-button>
            <el-button link type="primary" @click="openMilestoneEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleMilestoneDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="milestones.length === 0 && !milestoneLoading" description="还没有里程碑" :image-size="60" />
    </el-dialog>

    <!-- 里程碑表单 -->
    <el-dialog
      v-model="milestoneFormVisible"
      :title="milestoneEditingId ? '编辑里程碑' : '新建里程碑'"
      width="440px"
    >
      <el-form ref="milestoneFormRef" :model="milestoneForm" :rules="milestoneRules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="milestoneForm.name" maxlength="100" placeholder="如：完成文献综述" />
        </el-form-item>
        <el-form-item label="截止日期">
          <el-date-picker v-model="milestoneForm.dueDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="full-width" />
        </el-form-item>
        <el-form-item v-if="milestoneEditingId" label="状态">
          <el-radio-group v-model="milestoneForm.status">
            <el-radio value="pending">进行中</el-radio>
            <el-radio value="done">已完成</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="milestoneFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="milestoneLoading" @click="handleMilestoneSubmit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 项目成员 -->
    <el-dialog v-model="memberVisible" title="项目成员" width="560px">
      <div class="milestone-toolbar">
        <el-button type="primary" :disabled="addableMembers.length === 0" @click="memberDialogVisible = true">
          添加成员
        </el-button>
      </div>
      <el-table v-loading="memberLoading" :data="projectMembers">
        <el-table-column label="成员">
          <template #default="{ row }">
            <span>{{ row.nickname || row.username }}</span>
            <span class="member-username">@{{ row.username }}</span>
          </template>
        </el-table-column>
        <el-table-column label="加入时间" prop="joinedAt" width="180" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="danger" @click="handleRemoveMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="projectMembers.length === 0 && !memberLoading" description="暂无项目成员" :image-size="60" />
    </el-dialog>

    <!-- 添加成员 -->
    <el-dialog v-model="memberDialogVisible" title="添加项目成员" width="440px">
      <p class="dialog-hint">只能添加本课题组的成员</p>
      <el-select v-model="memberTarget" placeholder="选择成员" class="full-width" filterable>
        <el-option
          v-for="member in addableMembers"
          :key="member.userId"
          :label="`${member.nickname || member.username}（@${member.username}）`"
          :value="member.userId"
        />
      </el-select>
      <template #footer>
        <el-button @click="memberDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="memberLoading" @click="handleAddMember">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:deep(.milestone-linked) { --el-table-tr-bg-color: var(--el-color-primary-light-9); }
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-input {
  width: 240px;
}

.status-select {
  width: 140px;
}

.toolbar-primary {
  margin-left: auto;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.project-name {
  font-weight: 500;
  color: #303133;
  cursor: pointer;
}

.project-name:hover {
  color: #409eff;
}

.project-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}

.date-text {
  font-size: 13px;
  color: #606266;
}

.task-counts {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.full-width {
  width: 100%;
}

.drawer-title {
  margin: 20px 0 10px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-row {
  font-size: 13px;
  color: #303133;
}

.member-username {
  margin-left: 6px;
  font-size: 12px;
  color: #909399;
}

.milestone-toolbar {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;
}

.dialog-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: #909399;
}
</style>
