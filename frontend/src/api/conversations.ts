/**
 * 协作消息（C-5）。接口契约见 docs/01「协作沟通」一节：
 * 消息不产生任何埋点（红线 1）；未读汇总按 SRS 口径前端 30 秒轮询。
 * B-3 任务评论复用的 comment 类型会话也会出现在会话列表里（unreadCount 恒为 0）。
 */
import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 会话类型（docs/02 conversation.type） */
export type ConversationType = 'comment' | 'group' | 'private' | 'meeting'

/** 会话条目（含最后一条消息预览与未读数） */
export interface ConversationItem {
  id: string
  type: ConversationType
  title: string
  refType: string
  refId: string
  /** 无消息时为空字符串 */
  lastMessage: string
  lastMessageAt: string
  /** comment 类型恒为 0 */
  unreadCount: number
  updatedAt: string
}

/** 消息条目（按时间正序返回） */
export interface MessageItem {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string
  msgType: string
  createdAt: string
  refType?: string
  refId?: string
}

/** 未读汇总条目（30s 轮询返回体） */
export interface UnreadItem {
  conversationId: string
  unreadCount: number
}

/** 会话列表（按最近活动倒序，含未读数；仅自己参与的会话） */
export function fetchConversations(query?: PageQuery & { type?: ConversationType }) {
  return http.get<PageResult<ConversationItem>>('/api/v1/conversations', { params: query })
}

/** 创建/获取项目讨论区（一个项目一个 group 会话） */
export function ensureGroupConversation(projectId: string) {
  return http.post<ConversationItem>('/api/v1/conversations/group', { projectId })
}

/** 创建/获取私信会话（双方须在同一课题组） */
export function ensurePrivateConversation(peerUserId: string) {
  return http.post<ConversationItem>('/api/v1/conversations/private', { peerUserId })
}

/** 创建/获取会议讨论区，会话成员由后端按会议参会人同步。 */
export function ensureMeetingConversation(meetingId: string) {
  return http.post<ConversationItem>('/api/v1/conversations/meeting', { meetingId })
}

/** 会话详情（含未读数） */
export function fetchConversation(id: string) {
  return http.get<ConversationItem>(`/api/v1/conversations/${id}`)
}

/** 会话消息列表（时间正序；limit 1–200，默认 50） */
export function fetchMessages(id: string, limit = 50) {
  return http.get<MessageItem[]>(`/api/v1/conversations/${id}/messages`, { params: { limit } })
}

/** 发送消息；普通消息 1–2000 字符，录音 URL/信令允许更长；零埋点 */
export function sendMessage(
  id: string,
  content: string,
  options?: { msgType?: 'text' | 'audio' | 'call_signal'; refId?: string }
) {
  return http.post<MessageItem>(`/api/v1/conversations/${id}/messages`, {
    content,
    ...options
  })
}

/** 未读消息汇总（前端 30s 轮询） */
export function fetchUnread() {
  return http.get<UnreadItem[]>('/api/v1/conversations/unread')
}

/** 标记会话已读（推进 lastReadAt） */
export function markRead(id: string) {
  return http.post<{ ok: boolean }>(`/api/v1/conversations/${id}/read`)
}
