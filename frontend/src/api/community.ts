/**
 * 组队广场（线②，卡 E-1 / E-2）。接口契约见 docs/01「组队广场」：
 * 广场对全站登录用户可见；编辑 / 停止 / 删除 / 审批仅发帖人可操作，由后端判定。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 帖子状态：recruiting 招募中 / full 已满员 / closed 已停止 */
export type PostStatus = 'recruiting' | 'full' | 'closed'

/** 标签类别：competition 竞赛 / course 课程 */
export type TagCategory = 'competition' | 'course'

/** 申请状态：pending 待处理 / approved 已通过 / rejected 已拒绝（不可逆） */
export type ApplicationStatus = 'pending' | 'approved' | 'rejected'

/** 标签（字典与帖子内嵌共用） */
export interface CommunityTag {
  id: string
  name: string
  category: TagCategory
}

/** 发布人 / 申请人的名片：社区是跨组公开内容，只有昵称与头像 */
export interface PostAuthor {
  id: string
  nickname: string
  avatar: string
}

/** 当前用户在该帖的申请（卡 E-2），决定「申请加入」按钮的状态 */
export interface MyApplication {
  id: string
  status: ApplicationStatus
  note: string
  createdAt: string
  /** 未处理时为空字符串 */
  handledAt: string
}

/** 帖子结构（发布、编辑、列表项、详情同构） */
export interface CommunityPostItem {
  id: string
  title: string
  /** 无说明时为空字符串 */
  content: string
  recruitTotal: number
  recruitedCount: number
  status: PostStatus
  tags: CommunityTag[]
  author: PostAuthor
  /** 审批通过后绑定的课题组（卡 E-2），未绑定为 null */
  team: { id: string; name: string } | null
  /** 当前用户是否发帖人 */
  isAuthor: boolean
  /** 当前用户在该帖的申请，未申请为 null */
  myApplication: MyApplication | null
  /** 待处理申请数：仅发帖人有意义，其他人恒为 0 */
  pendingCount: number
  createdAt: string
  updatedAt: string
}

/** 申请条目 */
export interface ApplicationItem {
  id: string
  postId: string
  status: ApplicationStatus
  note: string
  createdAt: string
  /** 未处理时为空字符串 */
  handledAt: string
  applicant: PostAuthor
}

/** 审批（通过 / 拒绝）的响应 */
export interface HandleResult {
  application: ApplicationItem
  /** 处理后的帖子进度与状态，前端据此就地刷新 */
  post: {
    recruitedCount: number
    recruitTotal: number
    status: PostStatus
    team: { id: string; name: string } | null
  }
  /** 仅「本次审批自动创建了课题组」时返回：邀请码只在创建时给出一次 */
  inviteCode?: string
}

export interface PostPayload {
  title: string
  content?: string
  /** 字典 id，必选 1-3 个 */
  tagIds: string[]
  recruitTotal?: number
}

export interface ListPostsQuery extends PageQuery {
  /** 逗号分隔的标签 id，命中任一即返回 */
  tags?: string
  /** 关键词，匹配标题或正文 */
  q?: string
  status?: PostStatus
  mine?: boolean
}

export interface ListApplicationsQuery extends PageQuery {
  status?: ApplicationStatus
}

/** 标签字典（先竞赛后课程） */
export function fetchCommunityTags() {
  return http.get<CommunityTag[]>('/api/v1/community/tags')
}

/** 广场列表（按 id 倒序） */
export function fetchCommunityPosts(query?: ListPostsQuery) {
  return http.get<PageResult<CommunityPostItem>>('/api/v1/community/posts', { params: query })
}

/** 帖子详情 */
export function fetchCommunityPost(id: string) {
  return http.get<CommunityPostItem>(`/api/v1/community/posts/${id}`)
}

/** 发布招募帖 */
export function createCommunityPost(payload: PostPayload) {
  return http.post<CommunityPostItem>('/api/v1/community/posts', payload)
}

/** 编辑帖子（仅发帖人，仅「招募中」；未传字段保持不变） */
export function updateCommunityPost(id: string, payload: Partial<PostPayload>) {
  return http.put<CommunityPostItem>(`/api/v1/community/posts/${id}`, payload)
}

/** 停止招募（仅发帖人，转入「已停止」） */
export function closeCommunityPost(id: string) {
  return http.post<CommunityPostItem>(`/api/v1/community/posts/${id}/close`)
}

/** 删除帖子（仅发帖人，逻辑删除；还有待处理申请时后端返回 409） */
export function deleteCommunityPost(id: string) {
  return http.delete<null>(`/api/v1/community/posts/${id}`)
}

/** 申请加入（仅「招募中」的他人帖子；每人每帖至多一条申请） */
export function applyCommunityPost(postId: string, payload: { note?: string }) {
  return http.post<ApplicationItem>(`/api/v1/community/posts/${postId}/apply`, payload)
}

/** 某帖的申请列表（仅发帖人；按 id 倒序） */
export function fetchPostApplications(postId: string, query?: ListApplicationsQuery) {
  return http.get<PageResult<ApplicationItem>>(`/api/v1/community/posts/${postId}/applications`, {
    params: query
  })
}

/** 通过申请：自动建组入组、进度 +1、招满转「已满员」 */
export function approveApplication(id: string) {
  return http.post<HandleResult>(`/api/v1/community/applications/${id}/approve`)
}

/** 拒绝申请 */
export function rejectApplication(id: string) {
  return http.post<HandleResult>(`/api/v1/community/applications/${id}/reject`)
}
