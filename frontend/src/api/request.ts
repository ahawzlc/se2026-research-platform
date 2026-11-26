import axios, { type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useUserStore } from '@/store/user'
import type { ApiResult } from './types'

/** 业务成功码，与 docs/01-接口规范.md 保持一致 */
const SUCCESS_CODE = 0

const instance = axios.create({
  // 留空则走相对路径 /api，由 vite dev server 代理到后端
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 15000
})

instance.interceptors.request.use((config) => {
  const userStore = useUserStore()
  if (userStore.token) {
    config.headers.Authorization = `Bearer ${userStore.token}`
  }
  return config
})

let redirecting = false

/** 非 2xx 响应的返回体是统一结构时，取出后端给出的业务文案；不是统一结构（如网关的 HTML）时返回空 */
function backendMessage(error: unknown): string | undefined {
  const data = (error as { response?: { data?: ApiResult } } | null)?.response?.data
  return data && typeof data === 'object' && typeof data.message === 'string'
    ? data.message
    : undefined
}

/**
 * 业务型 401（登录密码错 / 改密旧密码错，卡 A-补2）：按 docs/01 与登录惯例返回 401，
 * 但这类失败不代表登录态失效——只提示错误，不触发清态跳登录。
 */
function isAuthBusinessPath(url?: string): boolean {
  return !!url && (url.includes('/auth/login') || url.includes('/auth/password'))
}

function handleUnauthorized(): void {
  if (redirecting) return
  redirecting = true
  const userStore = useUserStore()
  userStore.reset()
  ElMessage.warning('登录状态已失效，请重新登录')
  const current = router.currentRoute.value.fullPath
  void router
    .replace({
      name: 'login',
      query: current.startsWith('/login') ? {} : { redirect: current }
    })
    .finally(() => {
      redirecting = false
    })
}

instance.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResult
    // 非统一返回体（如直接返回文件流）时原样透传
    if (body === null || typeof body !== 'object' || !('code' in body)) {
      return response.data
    }
    if (body.code === SUCCESS_CODE) {
      return body.data
    }
    if (body.code === 401) {
      if (isAuthBusinessPath(response.config?.url)) {
        ElMessage.error(body.message || '操作失败')
      } else {
        handleUnauthorized()
      }
    } else {
      ElMessage.error(body.message || '请求失败')
    }
    return Promise.reject(new Error(body.message || `业务异常：${body.code}`))
  },
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error)
    const status = error?.response?.status
    if (status === 401) {
      if (isAuthBusinessPath(error?.config?.url)) {
        // 业务型 401 的返回体仍是统一结构（code/message）
        const msg = (error?.response?.data as ApiResult | undefined)?.message
        ElMessage.error(msg || '操作失败')
      } else {
        handleUnauthorized()
      }
    } else if (status === 403) {
      // 403 的返回体也是统一结构，后端写明了原因
      // （「你们还不是好友，每个方向只能发一条消息」「不是该课题组的成员」），
      // 这些规则只能靠这句话向用户解释，所以优先展示；没有返回体时才用通用提示
      ElMessage.error(backendMessage(error) || '没有操作权限')
    } else if (status === 404) {
      ElMessage.error(backendMessage(error) || '请求的资源不存在')
    } else if (status >= 500) {
      // 5xx 的后端文案可能带内部信息，仍用通用提示
      ElMessage.error('服务异常，请稍后重试')
    } else {
      // 400 / 409 等同样带统一返回体：优先展示后端给出的业务文案
      // （如「还有 1 条待处理申请，请先处理后再删除」），没有返回体时才退回 axios 的默认提示
      ElMessage.error(backendMessage(error) || error?.message || '网络异常，请稍后重试')
    }
    return Promise.reject(error)
  }
)

/**
 * 统一请求方法。响应拦截器已拆掉外层返回体，因此泛型 T 直接对应 data。
 */
export function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  // 响应拦截器已拆掉外层返回体，运行时直接就是 data，故此处断言为 T
  return instance.request(config) as Promise<T>
}

export const http = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, method: 'GET' }),
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, method: 'POST', data }),
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, method: 'PUT', data }),
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    request<T>({ ...config, url, method: 'DELETE' })
}

export default instance
