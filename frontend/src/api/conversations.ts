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
  /** 附件（msgType=file 时有值）；附件被删除后后端不下发此字段 */
  file?: {
    id: string
    originalName: string
    url: string
    /** 字节数，后端 BIGINT 序列化后为字符串 */
    size: string
    mimeType: string
  }
  createdAt: string
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

/** 创建/获取会议讨论区（线③ 卡 F-1；一个会议一个 meeting 会话） */
export function ensureMeetingConversation(meetingId: string) {
  return http.post<ConversationItem>('/api/v1/conversations/meeting', { meetingId })
}

/**
 * 会议讨论区是否只读（会议已结束或已删除 → true，前端据此禁用输入框）
 *
 * reason 用于给用户不同的说明文案（已结束 / 已删除），空串表示可发言。
 */
export function fetchMeetingDiscussionReadOnly(conversationId: string) {
  return http.get<{ readOnly: boolean; reason: string }>(
    `/api/v1/conversations/meeting/${conversationId}/readonly`
  )
}

/** 创建/获取私信会话（线③ 卡 E-3：不再要求同组；非好友每方向限发 1 条） */
export function ensurePrivateConversation(peerUserId: string) {
  return http.post<ConversationItem>('/api/v1/conversations/private', { peerUserId })
}

/**
 * 按 UID 打开/创建私信会话（线③ 卡 E-3）。
 * 好友页与个人主页只有对方 UID，故提供按 UID 的入口。
 */
export function openPrivateConversationByUid(uid: string) {
  return http.post<ConversationItem>('/api/v1/conversations/private-with', { uid })
}

/** 会话详情（含未读数） */
export function fetchConversation(id: string) {
  return http.get<ConversationItem>(`/api/v1/conversations/${id}`)
}

/** 会话消息列表（时间正序；limit 1–200，默认 50） */
export function fetchMessages(id: string, limit = 50) {
  return http.get<MessageItem[]>(`/api/v1/conversations/${id}/messages`, { params: { limit } })
}

/**
 * 发送消息（content 1–2000 字符；零埋点）
 *
 * 带 `fileId` 时为**文件消息**（线③ 收尾）：附件本体在 file 表，
 * content 存一句说明（如「会议纪要」）。fileId 必须是**自己**上传的附件。
 */
export function sendMessage(id: string, content: string, fileId?: string) {
  return http.post<MessageItem>(`/api/v1/conversations/${id}/messages`, {
    content,
    ...(fileId ? { fileId } : {})
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
