import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * 前端测试配置（线③ 卡 T-2）。
 *
 * 分两层：
 *  - `test/` 下的 `.test.ts` —— Vitest 跑 TypeScript 源码（纯逻辑 + 组件）；
 *  - `test/` 下的 `.test.cjs` —— 保留既有的 Node 原生测试（`npm run test:legacy`），
 *    它们用 vm + ts.transpile 加载模块，不依赖 Vitest，两套互不干扰。
 *
 * 之所以并存：既有测试是线② 留下来的资产，改造它会牵连一片；
 * 新写的用 Vitest，能直接测 Vue 组件与 TS 类型。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    globals: true,
    // 组件测试会挂 Element Plus，jsdom 缺 ResizeObserver
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts', 'src/store/**/*.ts']
    }
  }
})
