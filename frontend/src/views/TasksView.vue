<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import draggable from 'vuedraggable'
import { projectsApi, tasksApi, teamsApi } from '@/api'
import type { ProjectItem } from '@/api/projects'
import type { TaskItem, TaskPriority, TaskStatus } from '@/api/tasks'
import type { TeamMemberItem } from '@/api/teams'

/** 看板三列的元信息 */
const COLUMNS: { key: TaskStatus; label: string; type: 'info' | 'warning' | 'success' }[] = [
  { key: 'todo', label: '待办', type: 'info' },
  { key: 'doing', label: '进行中', type: 'warning' },
  { key: 'done', label: '已完成', type: 'success' }
]

/** 优先级中文名与配色 */
const PRIORITY_META: Record<TaskPriority, { label: string; type: 'danger' | 'warning' | 'info' }> = {
  high: { label: '高', type: 'danger' },
  medium: { label: '中', type: 'warning' },
  low: { label: '低', type: 'info' }
}

// ---------------------------------------------------------------- 数据

const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const tasks = ref<TaskItem[]>([])
const teamMembers = ref<TeamMemberItem[]>([])
const loading = ref(false)
const mineOnly = ref(false)

const currentProject = computed(() =>
  projects.value.find((p) => p.id === currentProjectId.value)
)

/**
 * 按列分组的任务（**可写**，供 vuedraggable 双向绑定）。
 *
 * 这里必须用 ref 持有可变数组而不是 computed：
 * computed 每次求值都会返回新数组，vuedraggable 拖拽时的原地修改会丢失。
 * 服务端数据仍是 tasks，columns 只是渲染视图，拖拽结束后统一回写。
 */
const columns = ref<Record<TaskStatus, TaskItem[]>>({
  todo: [],
  doing: [],
  done: []
})

/** 把服务端返回的任务按状态与排序值分列 */
function groupTasks(list: TaskItem[]): Record<TaskStatus, TaskItem[]> {
  const grouped: Record<TaskStatus, TaskItem[]> = { todo: [], doing: [], done: [] }
  for (const task of list) {
    grouped[task.status].push(task)
  }
  for (const key of Object.keys(grouped) as TaskStatus[]) {
    grouped[key].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  return grouped
}

async function loadProjects(): Promise<void> {
  const result = await projectsApi.fetchProjects({ page: 1, size: 100 })
  projects.value = result.list
  if (!projects.value.some((p) => p.id === currentProjectId.value)) {
    currentProjectId.value = projects.value[0]?.id ?? ''
  }
}

async function loadTasks(): Promise<void> {
  if (!currentProjectId.value) {
    tasks.value = []
    columns.value = { todo: [], doing: [], done: [] }
    return
  }
  loading.value = true
  try {
    const result = await tasksApi.fetchTasks({
      projectId: currentProjectId.value,
      mine: mineOnly.value ? true : undefined,
      page: 1,
      size: 100
    })
    tasks.value = result.list
    columns.value = groupTasks(result.list)
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
  void loadTasks()
  void loadMembers()
}

function handleMineToggle(): void {
  void loadTasks()
}

// ---------------------------------------------------------------- 拖拽

/**
 * 拖拽换列 / 换位。
 *
 * 处理流程：
 *   1. 记录拖动前的任务快照（用于失败回滚）；
 *   2. 拖动结束后先乐观更新本地状态（vuedraggable 已经改过 DOM 数组）；
 *   3. 调后端接口持久化：
 *      - 换列时调 `/status`（后端在此写 task_done 埋点）；
 *      - 同列换位时调 `/order`。
 *   4. 接口失败则回滚到快照并重新拉取，避免界面与数据库不一致。
 */
const snapshot = ref<TaskItem[]>([])

function handleDragStart(): void {
  snapshot.value = tasks.value.map((t) => ({ ...t }))
}

/** vuedraggable 的 `change` 事件载荷 */
interface DragChangeEvent {
  added?: { element: TaskItem; newIndex: number }
  removed?: { element: TaskItem; oldIndex: number }
  moved?: { element: TaskItem; oldIndex: number; newIndex: number }
}

/**
 * 列内容变化回调。
 *
 * 用 `change` 而不是 `add` / `update`：
 *   - `change` 的载荷是 vuedraggable 归一化过的 `{added, removed, moved}`，
 *     其中 `element` 是**数组里的那个对象**（含 id / sortOrder），可直接使用；
 *   - `add` / `update` 拿到的是 Sortable 原始事件，`evt.item` 只是 DOM 节点，
 *     拿不到任务 id。
 *
 * 三种情况：
 *   - `added`   跨列拖入本列 → 改状态 + 持久化本列顺序；
 *   - `removed` 本列拖出到别的列 → 交给目标列的 `added` 处理，这里不管；
 *   - `moved`   本列内换位 → 只持久化顺序。
 */
async function handleColumnChange(
  status: TaskStatus,
  event: DragChangeEvent
): Promise<void> {
  // 跨列拖入：先改状态（后端在此写 task_done 埋点），再持久化顺序
  if (event.added) {
    const moved = event.added.element
    try {
      const updated = await tasksApi.updateTaskStatus(moved.id, status)
      Object.assign(moved, updated)
      await persistColumnOrder(status, moved)
      ElMessage.success(
        updated.status === 'done'
          ? '任务已完成'
          : `任务已移至「${COLUMNS.find((c) => c.key === status)?.label}」`
      )
    } catch {
      await rollback()
    }
    return
  }

  // 同列换位：只持久化顺序
  if (event.moved) {
    const moved = event.moved.element
    try {
      await persistColumnOrder(status, moved)
    } catch {
      await rollback()
    }
  }
}

/**
 * 持久化某一列的排序。
 *
 * 做法：把被移动任务在列中的**前一个**与**后一个**邻居的 sort_order 报给后端，
 * 后端取中值作为新排序值（整数间隔策略，见 docs/01 任务章节）。
 *
 * 拖到列首时没有前邻居 → beforeSortOrder 传 null；
 * 拖到列尾时没有后邻居 → afterSortOrder 传 null。
 */
async function persistColumnOrder(status: TaskStatus, moved: TaskItem): Promise<void> {
  const list = columns.value[status]
  const index = list.findIndex((t) => t.id === moved.id)
  if (index < 0) return

  const before = index > 0 ? list[index - 1] : undefined
  const after = index < list.length - 1 ? list[index + 1] : undefined

  const updated = await tasksApi.updateTaskOrder(moved.id, {
    beforeSortOrder: before ? before.sortOrder : null,
    afterSortOrder: after ? after.sortOrder : null
  })
  Object.assign(moved, updated)
}

/** 拖拽失败回滚：恢复快照并重新拉取 */
async function rollback(): Promise<void> {
  tasks.value = snapshot.value.map((t) => ({ ...t }))
  columns.value = groupTasks(tasks.value)
  await loadTasks()
}

// ---------------------------------------------------------------- 任务表单

const formVisible = ref(false)
const formLoading = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref('')

const form = reactive({
  title: '',
  description: '',
  assigneeId: '',
  priority: 'medium' as TaskPriority,
  dueDate: '',
  status: 'todo' as TaskStatus
})

const rules: FormRules = {
  title: [
    { required: true, message: '请输入任务标题', trigger: 'blur' },
    { max: 200, message: '标题最长 200 个字符', trigger: 'blur' }
  ]
}

function openCreate(status: TaskStatus = 'todo'): void {
  editingId.value = ''
  form.title = ''
  form.description = ''
  form.assigneeId = ''
  form.priority = 'medium'
  form.dueDate = ''
  form.status = status
  formVisible.value = true
}

function openEdit(task: TaskItem): void {
  editingId.value = task.id
  form.title = task.title
  form.description = task.description
  form.assigneeId = task.assigneeId
  form.priority = task.priority
  form.dueDate = task.dueDate
  form.status = task.status
  formVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  formLoading.value = true
  try {
    const payload = {
      title: form.title,
      description: form.description || undefined,
      assigneeId: form.assigneeId || undefined,
      priority: form.priority,
      dueDate: form.dueDate || undefined
    }
    if (editingId.value) {
      await tasksApi.updateTask(editingId.value, payload)
      ElMessage.success('任务已更新')
    } else {
      await tasksApi.createTask({
        ...payload,
        projectId: currentProjectId.value,
        status: form.status
      })
      ElMessage.success('任务已创建')
    }
    formVisible.value = false
    await loadTasks()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    formLoading.value = false
  }
}

async function handleDelete(task: TaskItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除任务「${task.title}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await tasksApi.deleteTask(task.id)
    ElMessage.success('任务已删除')
    await loadTasks()
  } catch {
    // 提示由拦截器统一处理
  }
}

/** 是否已逾期：截止日期早于今天且未完成 */
function isOverdue(task: TaskItem): boolean {
  if (!task.dueDate || task.status === 'done') return false
  return task.dueDate < new Date().toISOString().slice(0, 10)
}

watch(currentProjectId, () => {
  void loadTasks()
  void loadMembers()
})

onMounted(async () => {
  await loadProjects()
  await loadTasks()
  await loadMembers()
})
</script>

<template>
  <div class="kanban-page">
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
          <el-checkbox v-model="mineOnly" @change="handleMineToggle">只看我负责的</el-checkbox>
          <span v-if="currentProject" class="project-meta">
            {{ currentProject.taskDone }} / {{ currentProject.taskTotal }} 已完成
          </span>
          <el-button type="primary" class="toolbar-primary" :disabled="!currentProjectId" @click="openCreate()">
            新建任务
          </el-button>
        </div>
      </template>

      <el-empty v-if="projects.length === 0 && !loading" description="还没有项目">
        <p class="empty-hint">请先到「项目管理」创建项目，再来建立任务</p>
      </el-empty>

      <el-skeleton v-else-if="loading" :rows="6" animated />

      <div v-else class="kanban">
        <div v-for="column in COLUMNS" :key="column.key" class="kanban-column">
          <div class="column-header">
            <el-tag :type="column.type" size="small">{{ column.label }}</el-tag>
            <span class="column-count">{{ columns[column.key].length }}</span>
            <el-button link type="primary" class="column-add" @click="openCreate(column.key)">
              ＋
            </el-button>
          </div>

          <draggable
            v-model="columns[column.key]"
            :group="{ name: 'tasks', pull: true, put: true }"
            item-key="id"
            :animation="150"
            class="column-body"
            ghost-class="drag-ghost"
            :sort="true"
            @start="handleDragStart"
            @change="handleColumnChange(column.key, $event)"
          >
            <template #item="{ element }: { element: TaskItem }">
              <div class="task-card">
                <div class="task-card-head">
                  <span class="task-title">{{ element.title }}</span>
                  <el-tag :type="PRIORITY_META[element.priority as TaskPriority]?.type ?? 'info'" size="small">
                    {{ PRIORITY_META[element.priority as TaskPriority]?.label ?? element.priority }}
                  </el-tag>
                </div>
                <div class="task-card-meta">
                  <span v-if="element.assigneeName" class="task-assignee">@{{ element.assigneeName }}</span>
                  <span v-else class="task-assignee task-unassigned">待认领</span>
                  <span v-if="element.dueDate" class="task-due" :class="{ 'task-overdue': isOverdue(element) }">
                    {{ element.dueDate }}
                  </span>
                </div>
                <div class="task-card-actions">
                  <el-button link type="primary" @click.stop="openEdit(element)">编辑</el-button>
                    <el-button link type="danger" @click.stop="handleDelete(element)">删除</el-button>
                </div>
              </div>
            </template>
          </draggable>

          <el-empty v-if="columns[column.key].length === 0" description="暂无任务" :image-size="50" />
        </div>
      </div>
    </el-card>

    <!-- 任务表单 -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑任务' : '新建任务'" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="200" placeholder="如：完成文献综述初稿" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="form.assigneeId" placeholder="待认领" clearable class="full-width" filterable>
            <el-option
              v-for="member in teamMembers"
              :key="member.userId"
              :label="`${member.nickname || member.username}`"
              :value="member.userId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="form.priority">
            <el-radio value="high">高</el-radio>
            <el-radio value="medium">中</el-radio>
            <el-radio value="low">低</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="截止日期">
          <el-date-picker v-model="form.dueDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="full-width" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="初始状态">
          <el-radio-group v-model="form.status">
            <el-radio value="todo">待办</el-radio>
            <el-radio value="doing">进行中</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="2000" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formLoading" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.project-select {
  width: 240px;
}

.project-meta {
  font-size: 13px;
  color: #909399;
}

.toolbar-primary {
  margin-left: auto;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.kanban {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 960px) {
  .kanban {
    grid-template-columns: 1fr;
  }
}

.kanban-column {
  background: #f5f7fa;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px;
  min-height: 320px;
}

.column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.column-count {
  font-size: 13px;
  color: #909399;
}

.column-add {
  margin-left: auto;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
}

.column-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 60px;
}

.task-card {
  background: #ffffff;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}

.task-card:hover {
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

.drag-ghost {
  opacity: 0.5;
  background: #ecf5ff;
}

.task-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.task-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  line-height: 1.5;
  word-break: break-word;
}

.task-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.task-assignee {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.task-unassigned {
  color: #c0c4cc;
}

.task-due {
  margin-left: auto;
}

.task-overdue {
  color: #f56c6c;
  font-weight: 500;
}

.task-card-actions {
  margin-top: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.task-card:hover .task-card-actions {
  opacity: 1;
}

.full-width {
  width: 100%;
}
</style>
