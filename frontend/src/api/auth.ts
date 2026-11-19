import { http } from './request'
import type { LoginPayload, LoginResult, RegisterPayload, UserInfo } from './types'

/** 登录，返回令牌与用户信息 */
export function login(payload: LoginPayload) {
  return http.post<LoginResult>('/api/v1/auth/login', payload)
}

/** 注册，成功后直接返回登录态 */
export function register(payload: RegisterPayload) {
  return http.post<LoginResult>('/api/v1/auth/register', payload)
}

/** 获取当前登录用户 */
export function fetchMe() {
  return http.get<UserInfo>('/api/v1/auth/me')
}

/** 修改个人资料的入参（昵称/邮箱至少传一个，校验在后端） */
export interface UpdateProfilePayload {
  nickname?: string
  email?: string
}

/** 修改个人资料（卡 A-补1），返回结构与 /auth/me 一致 */
export function updateProfile(payload: UpdateProfilePayload) {
  return http.put<UserInfo>('/api/v1/auth/profile', payload)
}

/**
 * 修改密码（卡 A-补2）：旧密码验证通过后签发新令牌，
 * 返回体与登录一致（{ token, user }），前端须就地替换令牌。
 * 已知取舍：无状态 JWT 无黑名单，旧令牌最长 7 天内仍有效（docs/08 卡 A-补2）。
 */
export function changePassword(payload: { oldPassword: string; newPassword: string }) {
  return http.put<LoginResult>('/api/v1/auth/password', payload)
}
