import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 项目状态 */
export type ProjectStatus = 'planning' | 'active' | 'finished' | 'archived'

/** 里程碑状态 */
export type MilestoneStatus = 'pending' | 'done'

/** 项目条目 */
export interface ProjectItem {
  id: string
  teamId: string
  name: string
  description: string
  status: ProjectStatus
  /** yyyy-MM-dd */
  startDate: string
  endDate: string
  memberCount: number
  milestoneTotal: number
  milestoneDone: number
  taskTotal: number
  taskTodo: number
  taskDoing: number
  taskDone: number
  createdAt: string
}

/** 项目成员 */
export interface ProjectMemberItem {
  userId: string
  username: string
  nickname: string
  avatar: string
  email: string
  joinedAt: string
}

/** 项目详情（附成员列表） */
export interface ProjectDetail extends ProjectItem {
  members: ProjectMemberItem[]
}

/** 里程碑 */
export interface MilestoneItem {
  id: string
  projectId: string
  name: string
  dueDate: string
  status: MilestoneStatus
  createdAt: string
}

export interface ProjectPayload {
  name: string
  description?: string
  teamId?: string
  status?: ProjectStatus
  startDate?: string
  endDate?: string
}

export interface MilestonePayload {
  projectId: string
  name: string
  dueDate?: string
  status?: MilestoneStatus
}

/** 项目列表（分页，仅本课题组可见） */
export function fetchProjects(query?: PageQuery & { status?: ProjectStatus; keyword?: string }) {
  return http.get<PageResult<ProjectItem>>('/api/v1/projects', { params: query })
}

/** 项目详情 */
export function fetchProject(id: string) {
  return http.get<ProjectDetail>(`/api/v1/projects/${id}`)
}

/** 创建项目 */
export function createProject(payload: ProjectPayload) {
  return http.post<ProjectItem>('/api/v1/projects', payload)
}

/** 更新项目 */
export function updateProject(id: string, payload: Partial<ProjectPayload>) {
  return http.put<ProjectItem>(`/api/v1/projects/${id}`, payload)
}

/** 删除项目 */
export function deleteProject(id: string) {
  return http.delete<void>(`/api/v1/projects/${id}`)
}

/** 项目成员列表 */
export function fetchProjectMembers(id: string) {
  return http.get<ProjectMemberItem[]>(`/api/v1/projects/${id}/members`)
}

/** 添加项目成员 */
export function addProjectMember(id: string, userId: string) {
  return http.post<ProjectMemberItem>(`/api/v1/projects/${id}/members`, { userId })
}

/** 移除项目成员 */
export function removeProjectMember(id: string, userId: string) {
  return http.delete<void>(`/api/v1/projects/${id}/members/${userId}`)
}

/** 里程碑列表 */
export function fetchMilestones(projectId: string, query?: { status?: MilestoneStatus }) {
  return http.get<MilestoneItem[]>(`/api/v1/projects/${projectId}/milestones`, { params: query })
}

/** 创建里程碑 */
export function createMilestone(payload: MilestonePayload) {
  return http.post<MilestoneItem>('/api/v1/milestones', payload)
}

/** 更新里程碑（置为 done 时后端写 milestone_done 埋点） */
export function updateMilestone(id: string, payload: Partial<Omit<MilestonePayload, 'projectId'>>) {
  return http.put<MilestoneItem>(`/api/v1/milestones/${id}`, payload)
}

/** 删除里程碑 */
export function deleteMilestone(id: string) {
  return http.delete<void>(`/api/v1/milestones/${id}`)
}
