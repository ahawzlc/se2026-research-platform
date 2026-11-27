/**
 * Vitest 全局准备（线③ 卡 T-2）。
 *
 * jsdom 缺的浏览器 API 在这里补齐——Element Plus 的表格/滚动条会用到，
 * 不补的话组件测试会直接抛 `ResizeObserver is not defined`。
 */
import { beforeEach, vi } from 'vitest'

/** ResizeObserver：Element Plus 的 el-table / el-scrollbar 依赖它 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** matchMedia：el-table 窄屏折叠、主题切换会查它 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub

/** jsdom 没有实现 scrollIntoView，组件里调用会报错 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

beforeEach(() => {
  // 每个用例前清掉 localStorage，避免登录态跨用例泄漏
  localStorage.clear()
  vi.restoreAllMocks()
})
