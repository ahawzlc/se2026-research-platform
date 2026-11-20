/**
 * 项目概览聚合（卡 B-补1/C-补1 共用）：跨项目拉任务与里程碑并做逾期/临期/在做什么的归类。
 * 没有独立后端接口，前端聚合既有接口（组内项目规模小，N+1 并行请求可接受）。
 */
import { projectsApi, tasksApi } from '@/api'
import type { MilestoneItem, ProjectItem } from '@/api/projects'
import type { TaskItem } from '@/api/tasks'

/** 今天（yyyy-MM-dd，与库里 dueDate 同格式） */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysLater(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
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
    overdueTasks: activeTasks.filter(isTaskOverdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    overdueMilestones: allMilestones
      .filter(isMilestoneOverdue)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    dueSoonTasks: activeTasks.filter(isTaskDueSoon).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }
}
