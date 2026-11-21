/**
 * 通知中心（卡 G-1，线①）。接口契约见 docs/01「通知中心」：
 * 通知由服务端 push 产生，前端只有读与已读两类操作；
 * 铃铛未读数 30s 轮询（与消息页未读同节奏、互不覆盖）。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 通知类型（docs/12 卡 G-1 冻结；meeting_upcoming 为 F-2 占位） */
export type NotificationType =
  | 'team_apply'
  | 'team_apply_approved'
  | 'team_apply_rejected'
  | 'friend_request'
  | 'friend_accepted'
  | 'meeting_upcoming'

/** 通知条目 */
export interface NotificationItem {
  id: string
  type: NotificationType | string
  title: string
  /** 跳转来源（community_post/friendship/meeting/conversation），无来源为空串 */
  refType: string
  refId: string
  /** 0 未读 / 1 已读 */
  isRead: number
  createdAt: string
}

/** 我的通知列表（按 id 倒序，可仅看未读） */
export function fetchNotifications(query?: PageQuery & { unreadOnly?: boolean }) {
  return http.get<PageResult<NotificationItem>>('/api/v1/notifications', { params: query })
}

/** 未读数（铃铛 30s 轮询） */
export function fetchUnreadCount() {
  return http.get<{ count: number }>('/api/v1/notifications/unread-count')
}

/** 单条已读（幂等；非本人通知按 404 处理） */
export function markNotificationRead(id: string) {
  return http.post<NotificationItem>(`/api/v1/notifications/${id}/read`)
}

/** 全部已读（返回本次标记条数） */
export function markAllNotificationsRead() {
  return http.post<{ updated: number }>('/api/v1/notifications/read-all')
}
