export interface ApiResult<T = unknown> {
  /** 业务状态码，0 表示成功 */
  code: number
  /** 提示信息 */
  message: string
  /** 数据体，失败时为 null */
  data: T
}

export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  size: number
}

export interface PageQuery {
  /** 页码，从 1 开始 */
  page?: number
  /** 每页条数，上限 100 */
  size?: number
}

export interface UserInfo {
  id: number
  username: string
  nickname: string
  avatar: string
  email: string
}

export interface LoginResult {
  token: string
  user: UserInfo
}

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  password: string
  nickname: string
  email?: string
}

export interface FileItem {
  id: number
  originalName: string
  url: string
  size: number
  mimeType: string
  createdAt: string
}
