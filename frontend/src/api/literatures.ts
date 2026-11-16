/**
 * 文献管理（C-1）。接口契约见 docs/01「文献」一节：
 * 创建写 literature_upload 埋点（单日上限 5）；阅读状态变 read 写 literature_read、
 * 从 read 退回撤销（均由后端处理）；删除为逻辑删除、不撤销历史埋点。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 阅读状态（docs/02 literature.read_status） */
export type ReadStatus = 'unread' | 'reading' | 'read'

/** 文献条目（列表与详情同构） */
export interface LiteratureItem {
  id: string
  teamId: string
  /** 未关联项目时为空字符串 */
  projectId: string
  title: string
  sourceUrl: string
  /** 无附件时为空字符串 */
  fileId: string
  fileName: string
  fileUrl: string
  /** 字节数，后端 BIGINT 序列化后为字符串，无附件时为空字符串 */
  fileSize: string
  readStatus: ReadStatus
  uploaderId: string
  uploaderName: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** 创建文献入参（fileId 与 sourceUrl 至少提供一个；校验在后端） */
export interface LiteraturePayload {
  teamId?: string
  projectId?: string
  title: string
  sourceUrl?: string
  fileId?: string
  tags?: string[]
}

/** 更新文献入参；空字符串/空数组表示清空对应字段（后端约定） */
export interface LiteratureUpdatePayload {
  title?: string
  projectId?: string
  sourceUrl?: string
  fileId?: string
  tags?: string[]
}

/** 文献列表（分页；仅本课题组可见） */
export function fetchLiteratures(
  query?: PageQuery & {
    teamId?: string
    projectId?: string
    readStatus?: ReadStatus
    tag?: string
    keyword?: string
  }
) {
  return http.get<PageResult<LiteratureItem>>('/api/v1/literatures', { params: query })
}

/** 文献详情 */
export function fetchLiterature(id: string) {
  return http.get<LiteratureItem>(`/api/v1/literatures/${id}`)
}

/** 创建文献（后端写 literature_upload 埋点，单日上限 5 条） */
export function createLiterature(payload: LiteraturePayload) {
  return http.post<LiteratureItem>('/api/v1/literatures', payload)
}

/** 更新文献（不含阅读状态；阅读状态走独立接口） */
export function updateLiterature(id: string, payload: LiteratureUpdatePayload) {
  return http.put<LiteratureItem>(`/api/v1/literatures/${id}`, payload)
}

/** 更新阅读状态（read 计 literature_read 埋点、退回撤销，均后端处理） */
export function updateReadStatus(id: string, readStatus: ReadStatus) {
  return http.put<LiteratureItem>(`/api/v1/literatures/${id}/read-status`, { readStatus })
}

/** 删除文献（逻辑删除；不撤销历史埋点） */
export function deleteLiterature(id: string) {
  return http.delete<void>(`/api/v1/literatures/${id}`)
}
