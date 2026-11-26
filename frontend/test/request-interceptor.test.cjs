/** HTTP 拦截器回归：非 2xx 响应优先展示后端文案（含 403 / 404），登录态失效的处理不变。 */
/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试直接加载 TS 模块 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/api/request.ts')
// import.meta 只在 ESM 里有意义，这里是 CommonJS：换成空对象，baseURL 取默认值
const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

/** 加载拦截器：axios、提示、路由、登录态都换成替身，返回「拒绝回调」和调用记录 */
function load() {
  const calls = { errors: [], warnings: [], resets: 0, replaces: [] }
  let onFulfilled
  let onRejected
  const axios = {
    create: () => ({
      interceptors: {
        request: { use() {} },
        response: {
          use(fulfilled, rejected) {
            onFulfilled = fulfilled
            onRejected = rejected
          }
        }
      }
    }),
    isCancel: () => false
  }
  const elementPlus = {
    ElMessage: {
      error: (message) => calls.errors.push(message),
      warning: (message) => calls.warnings.push(message)
    }
  }
  const router = {
    currentRoute: { value: { fullPath: '/messages' } },
    replace: async (target) => {
      calls.replaces.push(target)
    }
  }
  const exports = {}
  vm.runInNewContext(
    compiled,
    {
      exports,
      require(name) {
        if (name === 'axios') return axios
        if (name === 'element-plus') return elementPlus
        // 源码里是 `import router from '@/router'`，编译后取 .default，这里直接给路由替身
        if (name === '@/router') return router
        if (name === '@/store/user')
          return {
            useUserStore: () => ({
              token: 'token-1',
              userInfo: null,
              reset: () => (calls.resets += 1)
            })
          }
        throw new Error(`未声明的测试依赖：${name}`)
      }
    },
    { filename }
  )
  return {
    fulfill: (response) => onFulfilled(response),
    reject: (error) => onRejected(error),
    calls
  }
}

const httpError = (status, data, url = '/api/v1/conversations/1/messages') => ({
  response: { status, data },
  config: { url }
})
const envelope = (code, message) => ({ code, message, data: null })

test('403 优先展示后端文案（好友私信的限发规则只能靠这句话解释）', async () => {
  const app = load()
  const message = '你们还不是好友，每个方向只能发一条消息；加为好友后可自由交流'
  await assert.rejects(app.reject(httpError(403, envelope(403, message))))
  assert.deepEqual(app.calls.errors, [message])
})

test('404 优先展示后端文案', async () => {
  const app = load()
  await assert.rejects(app.reject(httpError(404, envelope(404, '会议不存在或已删除'))))
  assert.deepEqual(app.calls.errors, ['会议不存在或已删除'])
})

test('返回体不是统一结构时，退回原来的通用提示', async () => {
  const app = load()
  await assert.rejects(app.reject(httpError(403, '<html>Forbidden</html>')))
  await assert.rejects(app.reject(httpError(404, undefined)))
  assert.deepEqual(app.calls.errors, ['没有操作权限', '请求的资源不存在'])
})

test('5xx 不展示后端原始文案，仍用通用提示', async () => {
  const app = load()
  await assert.rejects(app.reject(httpError(500, envelope(500, 'SELECT * FROM user 失败'))))
  await assert.rejects(app.reject(httpError(503, envelope(503, '上游不可用'))))
  assert.deepEqual(app.calls.errors, ['服务异常，请稍后重试', '服务异常，请稍后重试'])
})

test('400 / 409 继续优先展示后端文案（线②的修复不回退）', async () => {
  const app = load()
  await assert.rejects(
    app.reject(httpError(409, envelope(409, '还有 1 条待处理申请，请先处理后再删除')))
  )
  await assert.rejects(
    app.reject(httpError(400, { code: 400, message: 'UID 格式不正确', data: null }))
  )
  assert.deepEqual(app.calls.errors, ['还有 1 条待处理申请，请先处理后再删除', 'UID 格式不正确'])
})

test('没有返回体的网络错误沿用 axios 的提示', async () => {
  const app = load()
  await assert.rejects(app.reject(new Error('Network Error')))
  assert.deepEqual(app.calls.errors, ['Network Error'])
})

test('普通接口的 401 仍然清登录态并跳登录页', async () => {
  const app = load()
  await assert.rejects(app.reject(httpError(401, envelope(401, '未登录'))))
  assert.equal(app.calls.resets, 1)
  // 跳转目标是在 vm 的另一个 realm 里创建的对象，按内容比较
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.replaces)), [
    { name: 'login', query: { redirect: '/messages' } }
  ])
  assert.deepEqual(app.calls.warnings, ['登录状态已失效，请重新登录'])
  assert.deepEqual(app.calls.errors, [])
})

test('登录与改密接口的 401 只提示，不清登录态', async () => {
  for (const url of ['/api/v1/auth/login', '/api/v1/auth/password']) {
    const app = load()
    await assert.rejects(app.reject(httpError(401, envelope(401, '用户名或密码错误'), url)))
    assert.deepEqual(app.calls.errors, ['用户名或密码错误'], url)
    assert.equal(app.calls.resets, 0, url)
    assert.deepEqual(app.calls.replaces, [], url)
  }
})

test('2xx 但业务码非 0：提示业务文案并拒绝（既有行为不变）', async () => {
  const app = load()
  await assert.rejects(
    app.fulfill({ data: envelope(409, '还有 1 条待处理申请，请先处理后再删除'), config: {} }),
    /待处理申请/
  )
  assert.deepEqual(app.calls.errors, ['还有 1 条待处理申请，请先处理后再删除'])
})

test('2xx 且业务码为 0：拆掉外层返回体，直接给出 data', async () => {
  const app = load()
  assert.deepEqual(
    await app.fulfill({ data: { code: 0, message: 'ok', data: { id: '1' } }, config: {} }),
    { id: '1' }
  )
  assert.deepEqual(app.calls.errors, [])
})
