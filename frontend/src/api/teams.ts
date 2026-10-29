import { http } from './request'
import type { PageQuery, PageResult } from './types'

/** 「我的课题组」条目（对应后端 MyTeamItem） */
export interface MyTeamItem {
  id: string
  name: string
  description: string
  /** 本人在该组的角色：owner / admin / member */
  role: string
  joinedAt: string
}

/** 建组返回（邀请码仅此处给出，后端不再提供回查） */
export interface CreatedTeam {
  id: string
  name: string
  description: string
  inviteCode: string
  ownerId: string
  createdAt: string
}

export interface TeamMemberItem {
  /** 用户 id（字符串，勿当数字运算） */
  userId: string
  username: string
  nickname: string
  avatar: string
  email: string
  role: string
  joinedAt: string
}

/** 可分配角色；owner 不通过接口修改 */
export type AssignableRole = 'admin' | 'member'

/** 创建课题组 */
export function createTeam(payload: { name: string; description?: string }) {
  return http.post<CreatedTeam>('/api/v1/teams', payload)
}

/** 凭邀请码入组 */
export function joinTeam(inviteCode: string) {
  return http.post<MyTeamItem>('/api/v1/teams/join', { inviteCode })
}

/** 我加入的课题组列表 */
export function fetchMyTeams() {
  return http.get<MyTeamItem[]>('/api/v1/teams/my')
}

/** 课题组成员列表（分页） */
export function fetchTeamMembers(teamId: string, query?: PageQuery) {
  return http.get<PageResult<TeamMemberItem>>(`/api/v1/teams/${teamId}/members`, {
    params: query
  })
}

/** 修改成员角色（仅组长） */
export function updateMemberRole(teamId: string, userId: string, role: AssignableRole) {
  return http.put<TeamMemberItem>(`/api/v1/teams/${teamId}/members/${userId}/role`, { role })
}
