<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { fileApi, literaturesApi, projectsApi, teamsApi } from '@/api'
import type { LiteratureItem, ReadStatus } from '@/api/literatures'
import type { ProjectItem } from '@/api/projects'
import type { MyTeamItem } from '@/api/teams'

/** 阅读状态中文名与标签配色（枚举与后端 READ_STATUSES 对齐，不得自造） */
const READ_STATUS_META: Record<ReadStatus, { label: string; tag: 'info' | 'warning' | 'success' }> = {
  unread: { label: '未读', tag: 'info' },
  reading: { label: '阅读中', tag: 'warning' },
  read: { label: '已读', tag: 'success' }
}

/** 与后端上传白名单/大小上限保持一致（file.constants.ts / Nginx 50m） */
const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.zip,.png,.jpg,.jpeg'
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

// ---------------------------------------------------------------- 列表与筛选

const list = ref<LiteratureItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)

/** 筛选条件（tag/keyword 为模糊匹配，readStatus 精确；均选填） */
const filters = reactive({ keyword: '', readStatus: '' as '' | ReadStatus, tag: '' })

/** 项目选择器数据源：编辑/新建时关联项目用（文献可不挂项目） */
const projects = ref<ProjectItem[]>([])
/** 我的课题组：不选项目时创建文献需要有明确归属组（后端默认取第一个组，前端显式传更稳） */
const myTeams = ref<MyTeamItem[]>([])

async function loadList(): Promise<void> {
  loading.value = true
  try {
    const result = await literaturesApi.fetchLiteratures({
      page: page.value,
      size: size.value,
      keyword: filters.keyword.trim() || undefined,
      readStatus: filters.readStatus || undefined,
      tag: filters.tag.trim() || undefined
    })
    list.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function applyFilters(): void {
  page.value = 1
  void loadList()
}

function handlePageChange(next: number): void {
  page.value = next
  void loadList()
}

// ---------------------------------------------------------------- 阅读状态

/** 表格内联改阅读状态（read 计 literature_read 埋点、退回撤销，均后端处理） */
async function handleReadStatusChange(row: LiteratureItem, status: ReadStatus): Promise<void> {
  try {
    const updated = await literaturesApi.updateReadStatus(row.id, status)
    row.readStatus = updated.readStatus
  } catch {
    // 失败提示由拦截器统一处理；不改本地状态
  }
}

// ---------------------------------------------------------------- 新建 / 编辑

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const dialogLoading = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref('')
const form = reactive({
  title: '',
  projectId: '',
  sourceUrl: '',
  fileId: '',
  fileName: '',
  tags: [] as string[]
})

/** 外链与附件至少提供一个（与后端口径一致的前端预检） */
const validateSource = (
  _rule: unknown,
  _value: string,
  callback: (error?: Error) => void
) => {
  if (!form.sourceUrl.trim() && !form.fileId) {
    callback(new Error('外链与附件至少提供一个'))
  } else {
    callback()
  }
}

const rules: FormRules = {
  title: [
    { required: true, message: '请输入文献标题', trigger: 'blur' },
    { max: 300, message: '标题最长 300 个字符', trigger: 'blur' }
  ],
  sourceUrl: [
    { max: 500, message: '外链最长 500 个字符', trigger: 'blur' },
    { validator: validateSource, trigger: 'blur' }
  ]
}

function openCreate(): void {
  dialogMode.value = 'create'
  editingId.value = ''
  form.title = ''
  form.projectId = ''
  form.sourceUrl = ''
  form.fileId = ''
  form.fileName = ''
  form.tags = []
  dialogVisible.value = true
}

function openEdit(row: LiteratureItem): void {
  dialogMode.value = 'edit'
  editingId.value = row.id
  form.title = row.title
  form.projectId = row.projectId
  form.sourceUrl = row.sourceUrl
  form.fileId = row.fileId
  form.fileName = row.fileName
  form.tags = [...row.tags]
  dialogVisible.value = true
}

/** 附件先走 C-4 统一上传拿到 file.id，再随文献保存 */
async function handleUpload(options: UploadRequestOptions): Promise<void> {
  const file = options.file
  if (file.size > UPLOAD_MAX_BYTES) {
    ElMessage.warning('附件不能超过 50MB')
    return
  }
  const uploaded = await fileApi.uploadFile(file)
  form.fileId = uploaded.id
  form.fileName = uploaded.originalName
  ElMessage.success('附件已上传，保存后生效')
}

function clearAttachment(): void {
  form.fileId = ''
  form.fileName = ''
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  dialogLoading.value = true
  try {
    if (dialogMode.value === 'create') {
      await literaturesApi.createLiterature({
        // 选了项目则由后端从项目归属解析课题组；否则显式落到我的第一个组
        projectId: form.projectId || undefined,
        teamId: form.projectId ? undefined : myTeams.value[0]?.id,
        title: form.title.trim(),
        sourceUrl: form.sourceUrl.trim() || undefined,
        fileId: form.fileId || undefined,
        tags: form.tags.length > 0 ? form.tags : undefined
      })
      ElMessage.success('文献已登记')
      page.value = 1
    } else {
      // 更新口径（docs/01）：空字符串/空数组表示清空对应字段
      await literaturesApi.updateLiterature(editingId.value, {
        title: form.title.trim(),
        projectId: form.projectId,
        sourceUrl: form.sourceUrl.trim(),
        fileId: form.fileId,
        tags: form.tags
      })
      ElMessage.success('文献已更新')
    }
    dialogVisible.value = false
    await loadList()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    dialogLoading.value = false
  }
}

// ---------------------------------------------------------------- 删除

async function handleRemove(row: LiteratureItem): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除后不可恢复；按参与度口径，已产生的 literature_upload 记录不会撤销。是否删除「${row.title}」？`,
    '删除文献',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await literaturesApi.deleteLiterature(row.id)
  ElMessage.success('已删除')
  // 删掉当前页最后一条时回退一页，避免停在空页
  if (list.value.length === 1 && page.value > 1) {
    page.value -= 1
  }
  await loadList()
}

onMounted(() => {
  void loadList()
  void projectsApi.fetchProjects({ page: 1, size: 100 }).then((r) => (projects.value = r.list))
  void teamsApi.fetchMyTeams().then((r) => (myTeams.value = r))
})
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="toolbar">
        <el-input
          v-model="filters.keyword"
          placeholder="按标题搜索"
          clearable
          class="filter-keyword"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
        <el-select
          v-model="filters.readStatus"
          placeholder="阅读状态"
          clearable
          class="filter-status"
          @change="applyFilters"
        >
          <el-option
            v-for="(meta, key) in READ_STATUS_META"
            :key="key"
            :label="meta.label"
            :value="key"
          />
        </el-select>
        <el-input
          v-model="filters.tag"
          placeholder="按标签过滤"
          clearable
          class="filter-tag"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
        <div class="toolbar-actions">
          <el-button type="primary" @click="openCreate">登记文献</el-button>
        </div>
      </div>
    </template>

    <el-table v-loading="loading" :data="list">
      <el-table-column label="标题" min-width="240">
        <template #default="{ row }">
          <span class="lit-title">{{ row.title }}</span>
          <div v-if="row.tags.length > 0" class="lit-tags">
            <span v-for="tag in row.tags" :key="tag" class="tag-chip">{{ tag }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="来源" min-width="160">
        <template #default="{ row }">
          <a v-if="row.sourceUrl" :href="row.sourceUrl" target="_blank" rel="noopener" class="file-link">
            外链
          </a>
          <a v-else-if="row.fileUrl" :href="row.fileUrl" target="_blank" class="file-link">
            {{ row.fileName }}
          </a>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="阅读状态" width="130">
        <template #default="{ row }">
          <el-select
            :model-value="row.readStatus"
            size="small"
            class="read-status-select"
            @change="(status: ReadStatus) => handleReadStatusChange(row, status)"
          >
            <el-option
              v-for="(meta, key) in READ_STATUS_META"
              :key="key"
              :label="meta.label"
              :value="key"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column prop="uploaderName" label="登记人" width="120" />
      <el-table-column prop="createdAt" label="登记时间" width="170" />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
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

    <!-- 登记 / 编辑文献 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '登记文献' : '编辑文献'"
      width="560px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="300" placeholder="如：Attention Is All You Need" />
        </el-form-item>
        <el-form-item label="关联项目">
          <el-select v-model="form.projectId" clearable filterable class="full-width" placeholder="选填">
            <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="外链" prop="sourceUrl">
          <el-input v-model="form.sourceUrl" maxlength="500" placeholder="https://…（与附件至少填一个）" />
        </el-form-item>
        <el-form-item label="附件">
          <div class="upload-area">
            <el-upload :accept="UPLOAD_ACCEPT" :show-file-list="false" :http-request="handleUpload">
              <el-button :disabled="!!form.fileId">选择文件</el-button>
            </el-upload>
            <span v-if="form.fileName" class="upload-file">
              {{ form.fileName }}
              <el-button link type="danger" @click="clearAttachment">移除</el-button>
            </span>
            <span v-else class="upload-hint">50MB 以内，白名单格式</span>
          </div>
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            class="full-width"
            placeholder="输入后回车创建，最多 10 个"
          >
            <el-option v-for="tag in form.tags" :key="tag" :label="tag" :value="tag" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="handleSubmit">
          {{ dialogMode === 'create' ? '登记' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-keyword {
  width: 200px;
}

.filter-status {
  width: 120px;
}

.filter-tag {
  width: 140px;
}

.toolbar-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.lit-title {
  font-weight: 500;
  color: #303133;
}

.lit-tags {
  margin-top: 4px;
}

.tag-chip {
  display: inline-block;
  margin: 0 6px 2px 0;
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

.read-status-select {
  width: 100px;
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
</style>
