/** 工作台真实 SFC setup 回归；网络为替身，不计浏览器验收。 */
/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试编译 Vue SFC */
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const vue = require('vue')
const { parse, compileScript } = require('vue/compiler-sfc')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../src/views/DashboardView.vue')
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const compiled = ts.transpileModule(compileScript(descriptor, { id: 'f2-dashboard' }).content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function meeting(id, hours) {
  const date = new Date(Date.now() + hours * 3_600_000 + 8 * 3_600_000)
  return { id, title: id, heldAt: date.toISOString().slice(0, 19).replace('T', ' ') }
}

function mount(rows, options = {}) {
  let mounted
  const user = { userInfo: vue.ref(options.userInfo ?? { id: 'u1' }), setUserInfo(info) { this.userInfo.value = info } }
  const router = { push: mock.fn(async () => {}) }
  const fetchMeetings = mock.fn(
    options.fetchMeetings ??
      (async ({ page, size }) => ({
        list: rows.slice((page - 1) * size, page * size),
        total: rows.length
      }))
  )
  const exports = {}
  const scope = vue.effectScope()
  vm.runInNewContext(
    compiled,
    {
      exports,
      require(name) {
        if (name === 'vue')
          return {
            ...vue,
            onMounted: (callback) => {
              mounted = callback
            }
          }
        if (name === '@/api') return {
          meetingsApi: { fetchMeetings },
          authApi: { fetchMe: async () => ({ id: 'u1', username: 'u1', nickname: '用户', email: '' }) }
        }
        if (name === '@/store/user') return { useUserStore: () => user }
        if (name === '@/router') return { __esModule: true, default: router }
        if (name === '@/utils/overview')
          return {
            loadOverview: async () => ({
              overdueTasks: [],
              overdueMilestones: [],
              myTasks: options.myTasks ?? []
            })
          }
        throw new Error(`未声明的测试依赖：${name}`)
      }
    },
    { filename }
  )
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  return { state, fetchMeetings, router, start: () => mounted(), stop: () => scope.stop() }
}

test('107场未来会议按接口倒序返回，工作台仍展示最近8场', async (t) => {
  const rows = Array.from({ length: 107 }, (_, i) => meeting(`m${107 - i}`, 107 - i))
  const app = mount(rows)
  t.after(app.stop)
  await app.start()
  assert.equal(app.fetchMeetings.mock.callCount(), 2)
  assert.deepEqual(
    Array.from(app.state.recentMeetings.value, (row) => row.id),
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
  )
})

test('读到已开始会议的页尾即可停止，不再扫描全量历史', async (t) => {
  const rows = [
    meeting('future', 1),
    ...Array.from({ length: 220 }, (_, i) => meeting(`past${i}`, -i - 1))
  ]
  const app = mount(rows)
  t.after(app.stop)
  await app.start()
  assert.equal(app.fetchMeetings.mock.callCount(), 1)
  assert.equal(app.state.recentMeetings.value[0].id, 'future')
})

test('超过7天和未安排时间的会议不进入卡片', async (t) => {
  const app = mount([meeting('far', 169), meeting('near', 1), { id: 'empty', heldAt: '' }])
  t.after(app.stop)
  await app.start()
  assert.deepEqual(
    Array.from(app.state.recentMeetings.value, (row) => row.id),
    ['near']
  )
})

test('会议请求失败保留工作台其他内容，会议卡为空', async (t) => {
  const app = mount([], {
    fetchMeetings: async () => {
      throw new Error('网络失败')
    }
  })
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.recentMeetings.value.length, 0)
  assert.equal(app.state.overdueTasks.value, 0)
})

function task(id, overrides = {}) {
  return {
    id,
    projectId: `p-${id}`,
    projectName: `项目 ${id}`,
    title: `任务 ${id}`,
    assigneeId: 'u1',
    status: 'todo',
    priority: 'medium',
    dueDate: '',
    ...overrides
  }
}

test('F-3 只展示当前用户未完成且已指派的跨项目任务', async (t) => {
  const app = mount([], {
    myTasks: [
      task('overdue', { dueDate: '2026-11-20' }),
      task('open', { dueDate: '2026-11-30' })
    ]
  })
  t.after(app.stop)
  await app.start()
  assert.deepEqual(Array.from(app.state.myTasks.value, (item) => item.id), ['overdue', 'open'])
  assert.deepEqual(Array.from(app.state.filteredMyTasks.value, (item) => item.id), ['overdue', 'open'])
})

test('F-3 筛选逾期和本周到期，按截止日期升序且无日期置底', async (t) => {
  const app = mount([], {
    myTasks: [
      task('later', { dueDate: '2099-12-31' }),
      task('none'),
      task('soon', { dueDate: '2026-11-26' }),
      task('old', { dueDate: '2020-01-01' })
    ]
  })
  t.after(app.stop)
  await app.start()
  assert.deepEqual(Array.from(app.state.filteredMyTasks.value, (item) => item.id), ['old', 'soon', 'later', 'none'])
  app.state.todoFilter.value = 'overdue'
  assert.deepEqual(Array.from(app.state.filteredMyTasks.value, (item) => item.id), ['old'])
  app.state.todoFilter.value = 'week'
  assert.deepEqual(Array.from(app.state.filteredMyTasks.value, (item) => item.id), ['soon'])
})

test('F-3 点击待办跳转到对应项目看板', async (t) => {
  const app = mount([], { myTasks: [task('1', { projectId: 'project-7' })] })
  t.after(app.stop)
  await app.start()
  app.state.openTaskBoard(app.state.myTasks.value[0])
  const target = app.router.push.mock.calls[0].arguments[0]
  assert.equal(target.path, '/tasks')
  assert.equal(target.query.projectId, 'project-7')
})
