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
      handleUnauthorized()
    } else {
      ElMessage.error(body.message || '请求失败')
    }
    return Promise.reject(new Error(body.message || `业务异常：${body.code}`))
  },
  (error) => {
    const status = error?.response?.status
    if (status === 401) {
      handleUnauthorized()
    } else if (status === 403) {
      ElMessage.error('没有操作权限')
    } else if (status === 404) {
      ElMessage.error('请求的资源不存在')
    } else if (status >= 500) {
      ElMessage.error('服务异常，请稍后重试')
    } else {
      ElMessage.error(error?.message || '网络异常，请稍后重试')
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
