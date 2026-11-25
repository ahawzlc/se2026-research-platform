/**
 * 会议记录（C-2）。接口契约见 docs/01「会议」一节：
 * 创建写 meeting_create 埋点；每个参会人各写一条 meeting_attend（同人同会只记一次）；
 * 更新参会人时后端同步撤销/重写埋点；删除为逻辑删除、不撤销历史埋点。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 会议参会人（详情/列表返回） */
export interface MeetingAttendeeItem {
  userId: string
  username: string
  nickname: string
  avatar: string
  email: string
}

/** 会议条目（列表与详情同构） */
export interface MeetingItem {
  id: string
  projectId: string
  projectName: string
  title: string
  /** yyyy-MM-dd HH:mm:ss（北京时间），未设置为空字符串 */
  heldAt: string
  status: 'upcoming' | 'ongoing' | 'ended' | 'unscheduled'
  location: string
  content: string
  attendees: MeetingAttendeeItem[]
  createdAt: string
  updatedAt: string
}

/** 创建会议入参（会议必须挂在项目下） */
export interface MeetingPayload {
  projectId: string
  title: string
  /** yyyy-MM-dd HH:mm:ss（北京时间） */
  heldAt?: string
  location?: string
  content?: string
  /** 参会人 userId 列表（本课题组成员，最多 50 人） */
  attendeeIds?: string[]
}

/** 更新会议入参；location/content/attendeeIds 传空表示清空；heldAt 空值时不传（后端 DTO 不收空串） */
export interface MeetingUpdatePayload {
  title?: string
  heldAt?: string
  location?: string
  content?: string
  attendeeIds?: string[]
}

/** 会议列表（分页，可按项目过滤，按 heldAt 倒序） */
export function fetchMeetings(query?: PageQuery & { projectId?: string }) {
  return http.get<PageResult<MeetingItem>>('/api/v1/meetings', { params: query })
}

/** 会议详情（含参会人列表） */
export function fetchMeeting(id: string) {
  return http.get<MeetingItem>(`/api/v1/meetings/${id}`)
}

/** 创建会议（后端写 meeting_create + 每参会人一条 meeting_attend） */
export function createMeeting(payload: MeetingPayload) {
  return http.post<MeetingItem>('/api/v1/meetings', payload)
}

/** 更新会议（基本信息 + 参会人全量替换；后端同步调整 meeting_attend 埋点） */
export function updateMeeting(id: string, payload: MeetingUpdatePayload) {
  return http.put<MeetingItem>(`/api/v1/meetings/${id}`, payload)
}

/** 删除会议（逻辑删除；不撤销历史埋点） */
export function deleteMeeting(id: string) {
  return http.delete<void>(`/api/v1/meetings/${id}`)
}
