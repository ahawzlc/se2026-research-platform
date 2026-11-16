/**
 * 成果登记（C-3）。接口契约见 docs/01「成果」一节：
 * 成果必须挂在项目下；创建写 achievement_submit 埋点；
 * contribution_note 仅展示，不参与任何计算（红线 1）。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 成果类型（docs/02 achievement.type，与后端 ACHIEVEMENT_TYPES 对齐） */
export type AchievementType = 'paper' | 'patent' | 'software' | 'award' | 'other'

/** 成果参与人（详情/列表返回） */
export interface AchievementMemberItem {
  userId: string
  username: string
  nickname: string
  avatar: string
  email: string
  /** 仅展示，不参与任何计算 */
  contributionNote: string
}

/** 成果条目（列表与详情同构，详情含 members） */
export interface AchievementItem {
  id: string
  projectId: string
  projectName: string
  type: AchievementType
  title: string
  description: string
  /** 附件 file.id，无附件时为空字符串 */
  fileId: string
  fileName: string
  fileUrl: string
  /** 字节数，后端 BIGINT 序列化后为字符串，无附件时为空字符串 */
  fileSize: string
  members: AchievementMemberItem[]
  createdAt: string
  updatedAt: string
}

/** 成果参与人入参 */
export interface AchievementMemberPayload {
  userId: string
  /** 仅展示，不参与任何计算，最长 255 字符 */
  contributionNote?: string
}

/** 创建成果入参（接口无更新，仅创建/删除） */
export interface AchievementPayload {
  projectId: string
  type: AchievementType
  title: string
  description?: string
  fileId?: string
  members?: AchievementMemberPayload[]
}

/** 成果列表（分页，可按项目过滤，仅本课题组可见） */
export function fetchAchievements(query?: PageQuery & { projectId?: string }) {
  return http.get<PageResult<AchievementItem>>('/api/v1/achievements', { params: query })
}

/** 成果详情（含参与人列表） */
export function fetchAchievement(id: string) {
  return http.get<AchievementItem>(`/api/v1/achievements/${id}`)
}

/** 创建成果（后端写 achievement_submit 埋点） */
export function createAchievement(payload: AchievementPayload) {
  return http.post<AchievementItem>('/api/v1/achievements', payload)
}

/** 删除成果（逻辑删除；按 docs/01 口径不撤销历史埋点） */
export function deleteAchievement(id: string) {
  return http.delete<void>(`/api/v1/achievements/${id}`)
}
