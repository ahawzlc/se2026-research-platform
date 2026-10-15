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
  /** 后端为 BIGINT 主键，序列化后是字符串，勿当数字用 */
  id: string
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
  /** 后端为 BIGINT 主键，序列化后是字符串，勿当数字用 */
  id: string
  originalName: string
  url: string
  /** 字节数，后端 BIGINT 序列化后为字符串 */
  size: string
  mimeType: string
  createdAt: string
}
