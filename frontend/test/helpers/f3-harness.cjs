/** 只替换网络与路由边界，执行真实 utils / SFC setup / template。 */
/* global require, __dirname, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试编译 Vue */
const { mock } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const vue = require('vue')
const { renderToString } = require('vue/server-renderer')
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc')
const ts = require('typescript')

const frontend = path.resolve(__dirname, '../..')
const filename = path.join(frontend, 'src/views/DashboardView.vue')
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'f3-dashboard' })
const template = compileTemplate({
  id: 'f3-dashboard',
  filename,
  source: descriptor.template.content,
  compilerOptions: { bindingMetadata: script.bindings }
})
if (template.errors.length) throw new Error(String(template.errors))

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
}
const scriptCode = compile(script.content)
const templateCode = compile(template.code)
const utilsCode = compile(fs.readFileSync(path.join(frontend, 'src/utils/overview.ts'), 'utf8'))

/** 无参数 new Date/Date.now 固定，有参数的日期运算保持原行为。 */
function fixedDate(now) {
  return class extends Date {
    constructor(...args) {
      if (args.length) super(...args)
      else super(now.getTime())
    }
    static now() {
      return now.getTime()
    }
  }
}

function loadUtils(api, Clock = Date) {
  const exports = {}
  vm.runInNewContext(utilsCode, {
    exports,
    Date: Clock,
    require(name) {
      if (name === '@/api') return api
      throw new Error(`未声明的工具依赖：${name}`)
    }
  })
  return exports
}

function makeApi(options = {}, rows = []) {
  const fetchTasks = mock.fn(options.fetchTasks ?? (async () => ({ list: [], total: 0 })))
  const fetchMe = mock.fn(options.fetchMe ?? (async () => ({ id: 'u1', nickname: '用户' })))
  const fetchMeetings = mock.fn(
    options.fetchMeetings ??
      (async ({ page, size }) => ({
        list: rows.slice((page - 1) * size, page * size),
        total: rows.length
      }))
  )
  return {
    tasksApi: { fetchTasks },
    authApi: { fetchMe },
    meetingsApi: { fetchMeetings },
    projectsApi: {
      fetchProjects: mock.fn(async () => ({ list: options.projects ?? [], total: 0 })),
      fetchMilestones: mock.fn(async () => options.milestones ?? [])
    }
  }
}

function mountDashboard(rows = [], options = {}) {
  let mounted
  const Clock = options.now ? fixedDate(options.now) : Date
  // 与 Pinia 一致：store.userInfo 是解包后的对象，不能拿 ref 冒充它。
  const user = vue.reactive({
    userInfo: options.userInfo === undefined ? { id: 'u1' } : options.userInfo,
    setUserInfo(info) {
      this.userInfo = info
    }
  })
  const api = makeApi(options, rows)
  const utils = loadUtils(api, Clock)
  const router = { push: mock.fn(async () => {}) }
  const exports = {}
  const scope = vue.effectScope()
  vm.runInNewContext(
    scriptCode,
    {
      exports,
      Date: Clock,
      require(name) {
        if (name === 'vue')
          return {
            ...vue,
            onMounted: (callback) => {
              mounted = callback
            }
          }
        if (name === '@/api') return api
        if (name === '@/store/user') return { useUserStore: () => user }
        if (name === '@/router') return { __esModule: true, default: router }
        if (name === '@/utils/overview') return utils
        throw new Error(`未声明的 SFC 依赖：${name}`)
      }
    },
    { filename }
  )
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))

  async function html() {
    const renderModule = {}
    vm.runInNewContext(templateCode, {
      exports: renderModule,
      require(name) {
        if (name === 'vue') return vue
        throw new Error(`未声明的模板依赖：${name}`)
      }
    })
    const app = vue.createSSRApp({ setup: () => state, render: renderModule.render })
    // 只替换 Element Plus 外壳，任务按钮、日期 class 和文字由真实模板渲染。
    for (const name of new Set(descriptor.template.content.match(/(?:el|router)-[a-z-]+/g))) {
      app.component(name, {
        setup(_, { slots, attrs }) {
          return () => vue.h('div', attrs, slots.default?.())
        }
      })
    }
    return renderToString(app)
  }

  return {
    state,
    api,
    utils,
    user,
    router,
    html,
    fetchMeetings: api.meetingsApi.fetchMeetings,
    start: () => mounted(),
    stop: () => scope.stop()
  }
}

function task(id, overrides = {}) {
  return {
    id,
    projectId: 'p1',
    projectName: '项目一',
    title: `任务 ${id}`,
    assigneeId: 'u1',
    status: 'todo',
    priority: 'medium',
    dueDate: '',
    sortOrder: 100,
    ...overrides
  }
}

function mountBoard(api, now) {
  const file = path.join(frontend, 'src/views/TasksView.vue')
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const code = compile(compileScript(descriptor, { id: 'f3-board' }).content)
  const Clock = fixedDate(now)
  const utils = loadUtils(api, Clock)
  const exports = {}
  const scope = vue.effectScope()
  vm.runInNewContext(
    code,
    {
      exports,
      Date: Clock,
      require(name) {
        // 用例手动调用 loadTasks，避免生命周期/项目切换引起无关的成员请求。
        if (name === 'vue') return { ...vue, watch() {}, onMounted() {} }
        if (name === 'vue-router') return { useRoute: () => ({ query: {} }) }
        if (name === 'element-plus') return { ElMessage: {}, ElMessageBox: {} }
        if (name === 'vuedraggable') return { __esModule: true, default: {} }
        if (name === '@/api') return api
        if (name === '@/utils/overview') return utils
        throw new Error(`未声明的看板依赖：${name}`)
      }
    },
    { filename: file }
  )
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  return { state, stop: () => scope.stop() }
}

module.exports = { fixedDate, loadUtils, makeApi, mountDashboard, mountBoard, task }
