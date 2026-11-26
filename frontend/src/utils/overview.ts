/**
 * 项目概览聚合（卡 B-补1/C-补1 共用）：跨项目拉任务与里程碑并做逾期/临期/在做什么的归类。
 * 没有独立后端接口，前端聚合既有接口（组内项目规模小，N+1 并行请求可接受）。
 */
import { projectsApi, tasksApi } from '@/api'
import type { MilestoneItem, ProjectItem } from '@/api/projects'
import type { TaskItem, TaskQuery } from '@/api/tasks'

/** 今天（yyyy-MM-dd，与库里 dueDate 同格式） */
export function today(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function daysLater(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return today(d)
}

/** 已逾期：截止日期早于今天且未完成（与 TasksView 看板标红同一口径） */
export function isTaskOverdue(task: TaskItem): boolean {
  return !!task.dueDate && task.status !== 'done' && task.dueDate < today()
}

/** 临期：今天起 3 天内截止且未完成 */
export function isTaskDueSoon(task: TaskItem): boolean {
  return (
    !!task.dueDate &&
    task.status !== 'done' &&
    task.dueDate >= today() &&
    task.dueDate <= daysLater(3)
  )
}

/** 里程碑逾期：未完成且截止日早于今天 */
export function isMilestoneOverdue(milestone: MilestoneItem): boolean {
  return milestone.status !== 'done' && milestone.dueDate < today()
}

/** 带项目上下文的里程碑条目（MilestoneItem 本身不含项目名） */
export interface MilestoneWithContext extends MilestoneItem {
  projectName: string
}

export interface OverviewSnapshot {
  projects: ProjectItem[]
  /** 全部未完成任务（跨项目） */
  activeTasks: TaskItem[]
  overdueTasks: TaskItem[]
  overdueMilestones: MilestoneWithContext[]
  /** 临期（3 天内）未完成任务 */
  dueSoonTasks: TaskItem[]
}

export async function loadOverview(): Promise<OverviewSnapshot> {
  const projectResult = await projectsApi.fetchProjects({ page: 1, size: 100 })
  const projects = projectResult.list

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const [tasksRes, milestones] = await Promise.all([
        tasksApi.fetchTasks({ projectId: project.id, page: 1, size: 100 }),
        projectsApi.fetchMilestones(project.id)
      ])
      return {
        tasks: tasksRes.list as TaskItem[],
        milestones: milestones.map((m) => ({ ...m, projectName: project.name }))
      }
    })
  )

  const allTasks = perProject.flatMap((p) => p.tasks)
  const allMilestones = perProject.flatMap((p) => p.milestones)
  const activeTasks = allTasks.filter((t) => t.status !== 'done')

  return {
    projects,
    activeTasks,
    overdueTasks: activeTasks
      .filter(isTaskOverdue)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    overdueMilestones: allMilestones
      .filter(isMilestoneOverdue)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    dueSoonTasks: activeTasks
      .filter(isTaskDueSoon)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }
}

/** 看板与我的待办共用的分页读取；权限范围由任务接口在服务端限定。 */
export async function fetchAllTasks(query: Omit<TaskQuery, 'page' | 'size'>): Promise<TaskItem[]> {
  const all: TaskItem[] = []
  for (let page = 1; ; page += 1) {
    const result = await tasksApi.fetchTasks({ ...query, page, size: 100 })
    all.push(...result.list)
    if (result.list.length === 0 || all.length >= result.total) return all
  }
}

/** 独立于网络的归属/状态过滤，接口异常返回其他负责人的任务时也不展示。 */
export function selectMyTasks(tasks: TaskItem[], userId?: string): TaskItem[] {
  if (!userId) return []
  return tasks.filter((task) => task.assigneeId === userId && task.status !== 'done')
}

export async function loadMyTasks(userId?: string): Promise<TaskItem[]> {
  if (!userId) return []
  return selectMyTasks(await fetchAllTasks({ assigneeId: userId }), userId)
}

export type TodoFilter = 'all' | 'overdue' | 'week'

/** 本周到期指今天至本周日；已过日期由“我逾期的”筛选承接。 */
export function filterMyTasks(tasks: TaskItem[], filter: TodoFilter, now = new Date()): TaskItem[] {
  const current = today(now)
  const sunday = new Date(now)
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7))
  const end = today(sunday)
  return tasks
    .filter((task) => {
      if (filter === 'overdue') return !!task.dueDate && task.dueDate < current
      if (filter === 'week') return !!task.dueDate && task.dueDate >= current && task.dueDate <= end
      return true
    })
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title)
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title)
    })
}
