/**
 * Pinia store 单测（线③ 卡 T-2）。
 *
 * 覆盖 `useUserStore` 的登录态生命周期：写入 → 持久化 → 登出清理。
 * 这是全站鉴权的根，store 一旦出问题，所有接口都会带上错误的 Authorization。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '@/store/user'

const TOKEN_KEY = 'se2026_token'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useUserStore', () => {
  it('初始状态：没有令牌也没有用户信息', () => {
    const store = useUserStore()
    expect(store.token).toBe('')
    expect(store.userInfo).toBeNull()
  })

  it('setToken 写入内存并持久化到 localStorage', () => {
    const store = useUserStore()
    store.setToken('token-abc')
    expect(store.token).toBe('token-abc')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('token-abc')
  })

  it('setToken(空串) 移除持久化的令牌', () => {
    const store = useUserStore()
    store.setToken('token-abc')
    store.setToken('')
    expect(store.token).toBe('')
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('setUserInfo 写入用户信息', () => {
    const store = useUserStore()
    store.setUserInfo({
      id: '1',
      username: 'alice',
      nickname: '爱丽丝'
    } as never)
    expect(store.userInfo?.nickname).toBe('爱丽丝')
  })

  it('reset 同时清掉令牌与用户信息（登出 / 401 失效共用）', () => {
    const store = useUserStore()
    store.setToken('token-abc')
    store.setUserInfo({ id: '1', username: 'alice' } as never)

    store.reset()

    expect(store.token).toBe('')
    expect(store.userInfo).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
