import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { UserInfo } from '@/api/types'

const TOKEN_KEY = 'se2026_token'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) ?? '')
  const userInfo = ref<UserInfo | null>(null)

  function setToken(value: string): void {
    token.value = value
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  function setUserInfo(info: UserInfo | null): void {
    userInfo.value = info
  }

  /** 清空登录态，令牌失效与主动登出共用 */
  function reset(): void {
    setToken('')
    setUserInfo(null)
  }

  return { token, userInfo, setToken, setUserInfo, reset }
})
