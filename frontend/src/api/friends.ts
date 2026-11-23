/**
 * 个人主页与好友相关接口（线③ 卡 E-3）。
 *
 * 术语说明：
 *   - publicUid：对外展示的 UID（形如 U0000000123），创建后不可变，可用于搜索与加好友；
 *   - profileVisibility：主页可见范围 public / friends / private；
 *   - relation：我与该用户的关系 none / pending_sent / pending_received / friends。
 */
import { http } from './request'

/** 主页可见范围 */
export type ProfileVisibility = 'public' | 'friends' | 'private'

/** 我与某用户的关系 */
export type UserRelation = 'none' | 'pending_sent' | 'pending_received' | 'friends'

export interface UserProfile {
  id: string
  username: string
  nickname: string
  avatar: string
  publicUid: string
  bio: string
  profileVisibility: ProfileVisibility
  createdAt: string
  relation: UserRelation
  isSelf: boolean
}

export interface UpdateProfilePayload {
  nickname?: string
  avatar?: string
  bio?: string
  profileVisibility?: ProfileVisibility
}

export interface FriendItem {
  id: string
  username: string
  nickname: string
  avatar: string
  publicUid: string
  bio: string
}

export interface FriendRequestItem extends FriendItem {
  /** 申请记录 id，同意/拒绝时传这个 */
  requestId: string
  createdAt: string
  /** incoming = 对方申请我；outgoing = 我申请对方 */
  direction: 'incoming' | 'outgoing'
}

/** 我的主页 */
export function fetchMyProfile() {
  return http.get<UserProfile>('/api/v1/users/me')
}

/** 更新我的主页资料（UID 与用户名不可改） */
export function updateMyProfile(payload: UpdateProfilePayload) {
  return http.put<UserProfile>('/api/v1/users/me', payload)
}

/** 按 UID 查用户（加好友前先确认对方存在） */
export function fetchUserByUid(uid: string) {
  return http.get<UserProfile>('/api/v1/users/by-uid', { params: { uid } })
}

/** 查看他人主页（可见范围由对方设置决定） */
export function fetchUserProfile(id: string) {
  return http.get<UserProfile>(`/api/v1/users/${id}`)
}

/** 我的好友列表 */
export function fetchFriends() {
  return http.get<{ list: FriendItem[]; total: number }>('/api/v1/friends')
}

/** 好友申请列表（收到的 + 发出的） */
export function fetchFriendRequests() {
  return http.get<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }>(
    '/api/v1/friends/requests'
  )
}

/** 通过 UID 发起好友申请 */
export function createFriendRequest(uid: string) {
  return http.post<FriendRequestItem>('/api/v1/friends/requests', { uid })
}

/** 同意好友申请 */
export function acceptFriendRequest(requestId: string) {
  return http.post<FriendItem>(`/api/v1/friends/requests/${requestId}/accept`)
}

/** 拒绝好友申请 */
export function rejectFriendRequest(requestId: string) {
  return http.post<void>(`/api/v1/friends/requests/${requestId}/reject`)
}

/** 删除好友（逻辑删除，双方同时不可见） */
export function removeFriend(id: string) {
  return http.delete<void>(`/api/v1/friends/${id}`)
}
