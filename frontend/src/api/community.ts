/**
 * 组队广场（线②，卡 E-1 / E-2）。接口契约见 docs/01「组队广场」：
 * 广场对全站登录用户可见；编辑 / 停止 / 删除仅发帖人可操作，由后端判定。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 帖子状态：recruiting 招募中 / full 已满员 / closed 已停止 */
export type PostStatus = 'recruiting' | 'full' | 'closed'

/** 标签类别：competition 竞赛 / course 课程 */
export type TagCategory = 'competition' | 'course'

/** 标签（字典与帖子内嵌共用） */
export interface CommunityTag {
  id: string
  name: string
  category: TagCategory
}

/** 发布人卡片：社区是跨组公开内容，只有昵称与头像 */
export interface PostAuthor {
  id: string
  nickname: string
  avatar: string
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
  createdAt: string
  updatedAt: string
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

/** 删除帖子（仅发帖人，逻辑删除） */
export function deleteCommunityPost(id: string) {
  return http.delete<null>(`/api/v1/community/posts/${id}`)
}
