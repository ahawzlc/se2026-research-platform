<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { achievementsApi, fileApi, projectsApi, teamsApi } from '@/api'
import type { AchievementItem, AchievementType } from '@/api/achievements'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'

/** 成果类型中文名与标签配色（类型枚举与后端 ACHIEVEMENT_TYPES 对齐，不得自造） */
const TYPE_META: Record<AchievementType, { label: string; tag: '' | 'success' | 'warning' | 'danger' | 'info' }> = {
  paper: { label: '论文', tag: '' },
  patent: { label: '专利', tag: 'warning' },
  software: { label: '软件著作权', tag: 'success' },
  award: { label: '获奖', tag: 'danger' },
  other: { label: '其他', tag: 'info' }
}

/** 与后端上传白名单/大小上限保持一致（file.constants.ts / Nginx 50m） */
const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.zip,.png,.jpg,.jpeg'
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

// ---------------------------------------------------------------- 列表

const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const currentProject = computed(() =>
  projects.value.find((p) => p.id === currentProjectId.value)
)

const list = ref<AchievementItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)

/** 参与人选择器的数据源：当前项目所属课题组的成员（与任务负责人同源） */
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
    const result = await achievementsApi.fetchAchievements({
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

// ---------------------------------------------------------------- 登记

const createVisible = ref(false)
const createLoading = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({
  type: 'paper' as AchievementType,
  title: '',
  description: '',
  memberIds: [] as string[],
  /** userId -> 贡献说明；仅展示，不参与任何计算（红线 1） */
  notes: {} as Record<string, string>,
  fileId: '',
  fileName: ''
})
const createRules: FormRules = {
  type: [{ required: true, message: '请选择成果类型', trigger: 'change' }],
  title: [
    { required: true, message: '请输入成果名称', trigger: 'blur' },
    { max: 300, message: '成果名称最长 300 个字符', trigger: 'blur' }
  ]
}

/** 已选参与人对应的成员行（供逐人填写贡献说明） */
const selectedMembers = computed(() =>
  teamMembers.value.filter((m) => createForm.memberIds.includes(m.userId))
)

function openCreate(): void {
  createForm.type = 'paper'
  createForm.title = ''
  createForm.description = ''
  createForm.memberIds = []
  createForm.notes = {}
  createForm.fileId = ''
  createForm.fileName = ''
  createVisible.value = true
}

/** 附件先走 C-4 统一上传拿到 file.id，再随成果创建提交 */
async function handleUpload(options: UploadRequestOptions): Promise<void> {
  const file = options.file
  if (file.size > UPLOAD_MAX_BYTES) {
    ElMessage.warning('附件不能超过 50MB')
    return
  }
  const uploaded = await fileApi.uploadFile(file)
  createForm.fileId = uploaded.id
  createForm.fileName = uploaded.originalName
  ElMessage.success('附件已上传，保存成果后生效')
}

function clearAttachment(): void {
  createForm.fileId = ''
  createForm.fileName = ''
}

async function handleCreate(): Promise<void> {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return
  createLoading.value = true
  try {
    await achievementsApi.createAchievement({
      projectId: currentProjectId.value,
      type: createForm.type,
      title: createForm.title.trim(),
      description: createForm.description || undefined,
      fileId: createForm.fileId || undefined,
      members: createForm.memberIds.map((userId) => ({
        userId,
        contributionNote: createForm.notes[userId]?.trim() || undefined
      }))
    })
    createVisible.value = false
    ElMessage.success('成果已登记')
    page.value = 1
    await loadList()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    createLoading.value = false
  }
}

// ---------------------------------------------------------------- 详情 / 删除

const detailVisible = ref(false)
const detail = ref<AchievementItem | null>(null)
const detailLoading = ref(false)

async function openDetail(row: AchievementItem): Promise<void> {
  detailVisible.value = true
  detailLoading.value = true
  try {
    detail.value = await achievementsApi.fetchAchievement(row.id)
  } finally {
    detailLoading.value = false
  }
}

async function handleRemove(row: AchievementItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除后不可恢复；按参与度口径，已产生的 achievement_submit 记录不会撤销。是否删除「${row.title}」？`,
    '删除成果',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await deleteAndReload(row.id)
}

async function deleteAndReload(id: string): Promise<void> {
  await achievementsApi.deleteAchievement(id)
  ElMessage.success('已删除')
  // 删掉当前页最后一条时回退一页，避免停在空页
  if (list.value.length === 1 && page.value > 1) {
    page.value -= 1
  }
  await loadList()
}

/** 字节数（字符串形态）转可读大小 */
function formatSize(bytes: string): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
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
            登记成果
          </el-button>
        </div>
      </div>
    </template>

    <el-empty
      v-if="projects.length === 0"
      description="还没有项目"
    >
      <p class="empty-hint">成果必须挂在项目下，请先到「项目管理」创建项目</p>
    </el-empty>

    <template v-else>
      <el-table v-loading="loading" :data="list">
        <el-table-column label="成果名称" min-width="220">
          <template #default="{ row }">
            <el-tag size="small" :type="TYPE_META[row.type as AchievementType].tag">
              {{ TYPE_META[row.type as AchievementType].label }}
            </el-tag>
            <span class="ach-title">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="projectName" label="所属项目" min-width="140" />
        <el-table-column label="参与人" min-width="180">
          <template #default="{ row }">
            <template v-if="row.members.length > 0">
              <span
                v-for="m in row.members"
                :key="m.userId"
                class="member-chip"
              >
                {{ m.nickname || m.username }}
              </span>
            </template>
            <span v-else class="muted">未关联</span>
          </template>
        </el-table-column>
        <el-table-column label="附件" min-width="140">
          <template #default="{ row }">
            <a v-if="row.fileUrl" :href="row.fileUrl" target="_blank" class="file-link">
              {{ row.fileName }}
            </a>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="登记时间" width="170" />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
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

    <!-- 登记成果 -->
    <el-dialog v-model="createVisible" title="登记成果" width="560px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="所属项目">
          <span>{{ currentProject?.name }}</span>
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="createForm.type" class="full-width">
            <el-option
              v-for="(meta, key) in TYPE_META"
              :key="key"
              :label="meta.label"
              :value="key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="成果名称" prop="title">
          <el-input v-model="createForm.title" maxlength="300" placeholder="如：一篇已录用论文的题目" />
        </el-form-item>
        <el-form-item label="说明" prop="description">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            maxlength="1000"
            placeholder="选填"
          />
        </el-form-item>
        <el-form-item label="附件">
          <div class="upload-area">
            <el-upload
              :accept="UPLOAD_ACCEPT"
              :show-file-list="false"
              :http-request="handleUpload"
            >
              <el-button>选择文件</el-button>
            </el-upload>
            <span v-if="createForm.fileName" class="upload-file">
              {{ createForm.fileName }}
              <el-button link type="danger" @click="clearAttachment">移除</el-button>
            </span>
            <span v-else class="upload-hint">50MB 以内，白名单格式</span>
          </div>
        </el-form-item>
        <el-form-item label="参与人">
          <el-select
            v-model="createForm.memberIds"
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
        <el-form-item
          v-for="m in selectedMembers"
          :key="m.userId"
          :label="m.nickname || m.username"
        >
          <el-input
            v-model="createForm.notes[m.userId]"
            maxlength="255"
            placeholder="该成员的贡献说明（选填，仅展示，不参与任何计算）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="handleCreate">登记</el-button>
      </template>
    </el-dialog>

    <!-- 成果详情 -->
    <el-dialog v-model="detailVisible" title="成果详情" width="640px">
      <div v-loading="detailLoading">
        <el-descriptions v-if="detail" :column="2" border>
          <el-descriptions-item label="类型">
            {{ TYPE_META[detail.type].label }}
          </el-descriptions-item>
          <el-descriptions-item label="所属项目">{{ detail.projectName }}</el-descriptions-item>
          <el-descriptions-item label="成果名称" :span="2">{{ detail.title }}</el-descriptions-item>
          <el-descriptions-item label="说明" :span="2">
            {{ detail.description || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="附件" :span="2">
            <a v-if="detail.fileUrl" :href="detail.fileUrl" target="_blank" class="file-link">
              {{ detail.fileName }}（{{ formatSize(detail.fileSize) }}）
            </a>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="登记时间" :span="2">{{ detail.createdAt }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="detail && detail.members.length > 0">
          <p class="members-title">参与人（贡献说明仅展示，不参与任何计算）</p>
          <el-table :data="detail.members" size="small">
            <el-table-column label="成员" min-width="140">
              <template #default="{ row }">
                {{ row.nickname || row.username }}
                <span class="muted">@{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" min-width="160" />
            <el-table-column prop="contributionNote" label="贡献说明" min-width="160">
              <template #default="{ row }">
                {{ row.contributionNote || '—' }}
              </template>
            </el-table-column>
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

.ach-title {
  margin-left: 8px;
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

.file-link {
  color: var(--el-color-primary);
  text-decoration: none;
}

.file-link:hover {
  text-decoration: underline;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.full-width {
  width: 100%;
}

.upload-area {
  display: flex;
  align-items: center;
  gap: 10px;
}

.upload-hint {
  font-size: 12px;
  color: #909399;
}

.upload-file {
  font-size: 13px;
  color: #303133;
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
</style>
