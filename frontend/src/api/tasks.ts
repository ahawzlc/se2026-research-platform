import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 看板三列 */
export type TaskStatus = 'todo' | 'doing' | 'done'

/** 任务优先级 */
export type TaskPriority = 'low' | 'medium' | 'high'

/** 任务条目 */
export interface TaskItem {
  id: string
  projectId: string
  projectName: string
  title: string
  description: string
  /** 未指派时为空串 */
  assigneeId: string
  assigneeName: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string
  /** 看板列内排序值（整数间隔） */
  sortOrder: number
  createdAt: string
}

/** 评论条目（统一会话模型下的一条 message） */
export interface CommentItem {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  msgType: string
  createdAt: string
}

export interface TaskPayload {
  projectId: string
  title: string
  description?: string
  assigneeId?: string
  priority?: TaskPriority
  dueDate?: string
  status?: TaskStatus
}

export interface TaskQuery extends PageQuery {
  projectId?: string
  status?: TaskStatus
  assigneeId?: string
  mine?: boolean
}

/** 任务列表 */
export function fetchTasks(query?: TaskQuery) {
  return http.get<PageResult<TaskItem>>('/api/v1/tasks', { params: query })
}

/** 任务详情 */
export function fetchTask(id: string) {
  return http.get<TaskItem>(`/api/v1/tasks/${id}`)
}

/** 新建任务 */
export function createTask(payload: TaskPayload) {
  return http.post<TaskItem>('/api/v1/tasks', payload)
}

/** 更新任务基本信息 */
export function updateTask(
  id: string,
  payload: Partial<Omit<TaskPayload, 'projectId'>>
) {
  return http.put<TaskItem>(`/api/v1/tasks/${id}`, payload)
}

/** 删除任务 */
export function deleteTask(id: string) {
  return http.delete<void>(`/api/v1/tasks/${id}`)
}

/**
 * 任务状态流转（看板换列）。
 *
 * 后端在流转到 done 时写 task_done 埋点，且同对象只计一次——
 * 反复把同一个任务拖到「已完成」不会重复计分。
 */
export function updateTaskStatus(id: string, status: TaskStatus) {
  return http.put<TaskItem>(`/api/v1/tasks/${id}/status`, { status })
}

/**
 * 看板列内排序持久化（整数间隔策略）。
 *
 * @param beforeSortOrder 拖到目标位置的前一个任务的 sortOrder；拖到列首时传 null
 * @param afterSortOrder  拖到目标位置的后一个任务的 sortOrder
 */
export function updateTaskOrder(
  id: string,
  params: { beforeSortOrder?: number | null; afterSortOrder?: number | null }
) {
  return http.put<TaskItem>(`/api/v1/tasks/${id}/order`, params)
}

/** 任务下的评论列表 */
export function fetchTaskComments(taskId: string) {
  return http.get<CommentItem[]>(`/api/v1/tasks/${taskId}/comments`)
}

/** 发表任务评论（单日上限 10 条，超出仍可发言但不计入参与度） */
export function createTaskComment(taskId: string, content: string) {
  return http.post<CommentItem>(`/api/v1/tasks/${taskId}/comments`, { content })
}
