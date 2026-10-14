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
