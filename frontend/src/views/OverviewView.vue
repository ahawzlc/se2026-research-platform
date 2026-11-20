<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProjectItem } from '@/api/projects'
import type { TaskItem, TaskPriority, TaskStatus } from '@/api/tasks'
import { loadOverview, today } from '@/utils/overview'
import type { OverviewSnapshot } from '@/utils/overview'

/**
 * 项目概览（卡 B-补1，SRS 故事 B07）：一屏回答「谁在做什么、哪些逾期」。
 * 逾期专区同时是 C-补1 逾期提醒的常驻入口；数据由 utils/overview 聚合既有接口。
 */
const route = useRoute()
const router = useRouter()

const snapshot = ref<OverviewSnapshot | null>(null)
const loading = ref(false)

/** 概览跳转参数：?projectId= 时过滤到单项目（从项目卡片点「查看任务」进来） */
const focusProjectId = ref((route.query.projectId as string) || '')

const visibleTasks = computed<TaskItem[]>(() => {
  if (!snapshot.value) return []
  const tasks = snapshot.value.activeTasks
  return focusProjectId.value
    ? tasks.filter((t) => t.projectId === focusProjectId.value)
    : tasks
})

const PRIORITY_META: Record<TaskPriority, { label: string; type: 'danger' | 'warning' | 'info' }> = {
  high: { label: '高', type: 'danger' },
  medium: { label: '中', type: 'warning' },
  low: { label: '低', type: 'info' }
}

const STATUS_META: Record<TaskStatus, { label: string; type: 'info' | 'warning' }> = {
  todo: { label: '待办', type: 'info' },
  doing: { label: '进行中', type: 'warning' },
  done: { label: '已完成', type: 'info' }
}

/** 谁在做什么：按负责人归组（跨项目），逾期任务排最前 */
const memberGroups = computed(() => {
  const groups = new Map<string, TaskItem[]>()
  for (const task of visibleTasks.value) {
    const key = task.assigneeName || '待认领'
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  return [...groups.entries()]
    .map(([name, tasks]) => ({
      name,
      tasks: [...tasks].sort((a, b) => {
        const aOver = a.dueDate && a.dueDate < today() ? 0 : 1
        const bOver = b.dueDate && b.dueDate < today() ? 0 : 1
        return aOver - bOver || a.dueDate.localeCompare(b.dueDate)
      })
    }))
    .sort((a, b) => b.tasks.length - a.tasks.length)
})

const overdueCount = computed(
  () => (snapshot.value?.overdueTasks.length ?? 0) + (snapshot.value?.overdueMilestones.length ?? 0)
)

/** 项目卡片排序：逾期的项目排前 */
const sortedProjects = computed<ProjectItem[]>(() => {
  if (!snapshot.value) return []
  const overdue = new Set([
    ...snapshot.value.overdueTasks.map((t) => t.projectId),
    ...snapshot.value.overdueMilestones.map((m) => m.projectId)
  ])
  return [...snapshot.value.projects].sort(
    (a, b) => Number(overdue.has(b.id)) - Number(overdue.has(a.id))
  )
})

function projectOverdue(id: string): number {
  if (!snapshot.value) return 0
  const tasks = snapshot.value.overdueTasks.filter((t) => t.projectId === id).length
  const milestones = snapshot.value.overdueMilestones.filter((m) => m.projectId === id).length
  return tasks + milestones
}

function projectProgress(project: ProjectItem): number {
  if (project.taskTotal === 0) return 0
  return Math.round((project.taskDone / project.taskTotal) * 100)
}

/** 项目截止临期/逾期提示（B-补1 对项目本身的截止日也给出提示） */
function projectEndDateHint(project: ProjectItem): { text: string; type: 'danger' | 'warning' } | null {
  if (!project.endDate) return null
  if (project.endDate < today()) return { text: `已过截止 ${project.endDate}`, type: 'danger' }
  const in7 = new Date()
  in7.setDate(in7.getDate() + 7)
  if (project.endDate <= in7.toISOString().slice(0, 10)) {
    return { text: `临近截止 ${project.endDate}`, type: 'warning' }
  }
  return null
}

function clearFocus(): void {
  focusProjectId.value = ''
  void router.replace({ query: {} })
}

function goTasks(projectId: string): void {
  void router.push({ path: '/tasks', query: { projectId } })
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    snapshot.value = await loadOverview()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="overview" v-loading="loading">
    <!-- ① 逾期提醒（C-补1 常驻入口） -->
    <h2 class="section-title">逾期提醒</h2>
    <el-alert
      v-if="overdueCount > 0"
      type="error"
      :closable="false"
      show-icon
      :title="`${snapshot?.overdueTasks.length ?? 0} 个任务、${snapshot?.overdueMilestones.length ?? 0} 个里程碑已逾期`"
    >
      <div class="overdue-list">
        <div v-for="task in snapshot?.overdueTasks" :key="'t' + task.id" class="overdue-item">
          <span class="overdue-date">{{ task.dueDate }}</span>
          <span class="overdue-title">{{ task.title }}</span>
          <span class="muted">{{ task.projectName }}</span>
          <span class="muted">{{ task.assigneeName || '待认领' }}</span>
        </div>
        <div v-for="m in snapshot?.overdueMilestones" :key="'m' + m.id" class="overdue-item">
          <span class="overdue-date">{{ m.dueDate }}</span>
          <span class="overdue-title">里程碑：{{ m.name }}</span>
          <span class="muted">{{ m.projectName }}</span>
        </div>
      </div>
    </el-alert>
    <el-alert
      v-else-if="snapshot"
      type="success"
      :closable="false"
      show-icon
      title="暂无逾期：所有未完成任务与里程碑均未过截止日期"
    />

    <!-- ② 项目健康 -->
    <h2 class="section-title">项目健康</h2>
    <el-empty v-if="snapshot && snapshot.projects.length === 0" description="还没有项目" />
    <el-row v-else :gutter="16">
      <el-col v-for="project in sortedProjects" :key="project.id" :xs="24" :sm="12" :lg="8">
        <el-card shadow="never" class="project-card">
          <div class="project-head">
            <span class="project-name">{{ project.name }}</span>
            <el-tag v-if="projectOverdue(project.id) > 0" type="danger" size="small">
              逾期 {{ projectOverdue(project.id) }}
            </el-tag>
          </div>
          <div class="project-line">
            <span class="muted">任务进度</span>
            <el-progress
              :percentage="projectProgress(project)"
              :stroke-width="10"
              class="project-progress"
            />
            <span class="muted">{{ project.taskDone }}/{{ project.taskTotal }}</span>
          </div>
          <div class="project-line">
            <span class="muted">里程碑</span>
            <span>{{ project.milestoneDone }}/{{ project.milestoneTotal }}</span>
            <span v-if="projectEndDateHint(project)" class="end-hint" :class="projectEndDateHint(project)!.type">
              {{ projectEndDateHint(project)!.text }}
            </span>
          </div>
          <div class="project-actions">
            <el-button size="small" @click="goTasks(project.id)">查看任务</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ③ 谁在做什么 -->
    <h2 class="section-title">
      谁在做什么
      <el-button v-if="focusProjectId" link type="primary" size="small" @click="clearFocus">
        显示全部项目
      </el-button>
    </h2>
    <el-empty v-if="snapshot && visibleTasks.length === 0" description="没有进行中的任务" />
    <el-card v-for="group in memberGroups" v-else :key="group.name" shadow="never" class="member-card">
      <template #header>
        <span class="member-name">{{ group.name }}</span>
        <span class="muted member-count">{{ group.tasks.length }} 项未完成</span>
      </template>
      <div v-for="task in group.tasks" :key="task.id" class="work-item">
        <el-tag size="small" :type="STATUS_META[task.status].type">{{ STATUS_META[task.status].label }}</el-tag>
        <el-tag size="small" :type="PRIORITY_META[task.priority as TaskPriority].type" effect="plain">
          {{ PRIORITY_META[task.priority as TaskPriority].label }}
        </el-tag>
        <span class="work-title">{{ task.title }}</span>
        <span class="muted">{{ task.projectName }}</span>
        <span v-if="task.dueDate" class="work-due" :class="{ 'is-overdue': task.dueDate < today() }">
          截止 {{ task.dueDate }}
        </span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
}

.section-title {
  margin: 20px 0 12px;
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}

.section-title:first-child {
  margin-top: 0;
}

.overdue-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.overdue-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.overdue-date {
  font-weight: 600;
  color: var(--el-color-danger);
}

.overdue-title {
  color: #303133;
}

.muted {
  color: #909399;
  font-size: 12px;
}

.project-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.project-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.project-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.project-line {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.project-progress {
  flex: 1;
}

.end-hint {
  font-size: 12px;
}

.end-hint.danger {
  color: var(--el-color-danger);
}

.end-hint.warning {
  color: var(--el-color-warning);
}

.project-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.member-card {
  margin-bottom: 12px;
}

.member-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.member-count {
  margin-left: 8px;
}

.work-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}

.work-item:last-child {
  border-bottom: none;
}

.work-title {
  color: #303133;
}

.work-due {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
}

.work-due.is-overdue {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
