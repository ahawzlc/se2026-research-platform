/**
 * F-2 页面脚本回归：执行真实 SFC 的 setup 与 Vue 响应式逻辑。
 * 只替换网络、路由和弹窗边界；无需新增测试依赖。
 * 不替代真实浏览器验收，截图与 v-loading 的视觉效果仍须手工核对。
 * 运行：cd frontend && node --test test/f2-meetings.test.cjs
 */
/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试使用 CommonJS 加载 SFC 编译器 */
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const vue = require('vue')
const { parse, compileScript } = require('vue/compiler-sfc')
const ts = require('typescript')
const { setImmediate: flushPromises } = require('node:timers/promises')

const filename = path.resolve(__dirname, '../src/views/MeetingsView.vue')
const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'f2-regression' })
const compiled = ts.transpileModule(script.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function meeting(id, heldAt = '2030-01-01 10:00:00') {
  return {
    id,
    projectId: 'p1',
    projectName: '项目一',
    title: `会议 ${id}`,
    heldAt,
    status: 'upcoming',
    attendees: [],
    location: '',
    content: '',
    createdAt: heldAt,
    updatedAt: heldAt
  }
}

function mount(query = {}, rows = [meeting('m1')], fetchDetail, options = {}) {
  const route = vue.reactive({ query })
  let mounted
  const api = {
    meetingsApi: {
      fetchMeetings: mock.fn(
        options.fetchMeetings ?? (async () => ({ list: rows, total: rows.length }))
      ),
      fetchMeeting: mock.fn(fetchDetail ?? (async (id) => meeting(id))),
      createMeeting: mock.fn(options.createMeeting ?? (async () => meeting('created'))),
      updateMeeting: mock.fn(options.updateMeeting ?? (async () => meeting('updated'))),
      deleteMeeting: mock.fn(options.deleteMeeting ?? (async () => {}))
    },
    projectsApi: {
      fetchProjects: async () => ({ list: [{ id: 'p1', name: '项目一' }] }),
      fetchProject: async () => ({ teamId: 't1' })
    },
    teamsApi: { fetchTeamMembers: async () => ({ list: [] }) }
  }
  const exports = {}
  const scope = vue.effectScope()
  const context = vm.createContext({
    exports,
    require(name) {
      if (name === 'vue')
        return {
          ...vue,
          onMounted: (callback) => {
            mounted = callback
          }
        }
      if (name === 'vue-router')
        return {
          useRoute: () => route,
          useRouter: () => ({
            replace: async ({ query }) => {
              route.query = query
            }
          })
        }
      if (name === 'element-plus')
        return {
          ElMessage: { success() {} },
          ElMessageBox: { confirm: async () => 'confirm' }
        }
      if (name === '@/api') return api
      throw new Error(`未声明的测试依赖：${name}`)
    }
  })
  vm.runInContext(compiled, context, { filename })
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  return { state, route, api, start: () => mounted(), stop: () => scope.stop() }
}

test('直开 meetingId：项目列表加载后自动打开目标会议', async (t) => {
  const app = mount({ meetingId: 'm1' })
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.detailVisible.value, true)
  assert.equal(app.state.detail.value.id, 'm1')
  assert.equal(app.api.meetingsApi.fetchMeetings.mock.callCount(), 1)
  assert.equal(app.api.meetingsApi.fetchMeeting.mock.callCount(), 1)
})

test('其他项目会议不在当前列表：仍按 id 获取并打开', async (t) => {
  const app = mount({ meetingId: 'other' })
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.detail.value.id, 'other')
  assert.equal(app.api.meetingsApi.fetchMeeting.mock.calls[0].arguments[0], 'other')
})

test('会议页内再次点其他通知：query 变化会重新打开详情', async (t) => {
  const app = mount({ meetingId: 'm1' })
  t.after(app.stop)
  await app.start()
  app.state.detailVisible.value = false
  app.route.query = { meetingId: 'm2' }
  await vue.nextTick()
  // nextTick 只等待 Vue 更新，不等待 vm 内异步详情请求；等微任务队列清空后断言。
  await flushPromises()
  assert.equal(app.state.detailVisible.value, true)
  assert.equal(app.state.detail.value.id, 'm2')
})

test('首开即显示 loading，失败关闭弹窗且不残留旧会议', async (t) => {
  let reject
  const pending = new Promise((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  const app = mount({}, [], () => pending)
  t.after(app.stop)
  await app.start()
  app.state.detail.value = meeting('old')
  const opening = app.state.openDetail({ id: 'denied' })
  assert.equal(app.state.detailVisible.value, true)
  assert.equal(app.state.detailLoading.value, true)
  assert.equal(app.state.detail.value, null)
  reject(new Error('403'))
  await opening
  assert.equal(app.state.detailVisible.value, false)
  assert.equal(app.state.detailLoading.value, false)
  assert.equal(app.state.detail.value, null)
})

test('详情关闭后清理 meetingId，再点同一提醒可重新打开且保留其他 query', async (t) => {
  const app = mount({ meetingId: 'm1', source: 'bell' })
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.detailVisible.value, true)
  // Element Plus 2.14.7：先 closed，下一步才 update:modelValue=false。
  app.state.handleDetailClosed()
  app.state.detailVisible.value = false
  await vue.nextTick()
  assert.equal(app.route.query.meetingId, undefined)
  assert.equal(app.route.query.source, 'bell')
  app.route.query = { ...app.route.query, meetingId: 'm1' }
  await vue.nextTick()
  await flushPromises()
  assert.equal(app.state.detailVisible.value, true)
  assert.equal(app.state.detail.value.id, 'm1')
  assert.equal(app.api.meetingsApi.fetchMeeting.mock.callCount(), 2)
})

test('重复参数或无参数不会发出错误详情请求', async (t) => {
  for (const query of [{}, { meetingId: ['m1', 'm2'] }, { meetingId: '' }]) {
    const app = mount(query)
    t.after(app.stop)
    await app.start()
    assert.equal(app.api.meetingsApi.fetchMeeting.mock.callCount(), 0)
  }
})

test('即将开始先按时间升序再分页，最近一场出现在第一页', async (t) => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    meeting(String(i), `2030-01-${String(12 - i).padStart(2, '0')} 10:00:00`)
  )
  const app = mount({}, rows)
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.pagedMeetings.value.length, 10)
  assert.equal(app.state.pagedMeetings.value[0].heldAt, '2030-01-01 10:00:00')
  assert.equal(rows[0].heldAt, '2030-01-12 10:00:00')
})

test('较早请求晚返回时，不覆盖后来点击的会议', async (t) => {
  const resolve = {}
  const app = mount(
    {},
    [],
    (id) =>
      new Promise((done) => {
        resolve[id] = done
      })
  )
  t.after(app.stop)
  await app.start()
  const first = app.state.openDetail({ id: 'first' })
  const second = app.state.openDetail({ id: 'second' })
  resolve.second(meeting('second'))
  await second
  resolve.first(meeting('first'))
  await first
  assert.equal(app.state.detail.value.id, 'second')
  assert.equal(app.state.detailLoading.value, false)
})

test('进行中会议位于未结束页签前部，已结束/未安排不混入', async (t) => {
  const rows = [
    meeting('future'),
    { ...meeting('live', '2029-12-31 23:00:00'), status: 'ongoing' },
    { ...meeting('ended', '2029-12-31 20:00:00'), status: 'ended' },
    { ...meeting('unscheduled', ''), status: 'unscheduled' }
  ]
  const app = mount({}, rows)
  t.after(app.stop)
  await app.start()
  assert.deepEqual(
    Array.from(app.state.filteredMeetings.value, (row) => row.id),
    ['live', 'future']
  )
  assert.equal(app.state.statusLabel('ongoing'), '进行中')
  app.state.activeTab.value = 'ended'
  assert.deepEqual(
    Array.from(app.state.filteredMeetings.value, (row) => row.id),
    ['ended']
  )
  app.state.activeTab.value = 'all'
  assert.equal(app.state.filteredMeetings.value.length, 4)
})

test('12月31日连续翻月能到次年二月，3月31日上翻能到二月', async (t) => {
  const app = mount()
  t.after(app.stop)
  app.state.calendarMonth.value = new Date(2026, 11, 31)
  app.state.changeMonth(1)
  assert.equal(app.state.monthLabel.value, '2027 年 1 月')
  app.state.changeMonth(1)
  assert.equal(app.state.monthLabel.value, '2027 年 2 月')
  assert.equal(app.state.calendarMonth.value.getDate(), 1)
  app.state.calendarMonth.value = new Date(2027, 2, 31)
  app.state.changeMonth(-1)
  assert.equal(app.state.monthLabel.value, '2027 年 2 月')
})

test('闰年31日翻入二月不溢出，跨年上一月正常', async (t) => {
  const app = mount()
  t.after(app.stop)
  app.state.calendarMonth.value = new Date(2028, 0, 31)
  app.state.changeMonth(1)
  assert.equal(app.state.monthLabel.value, '2028 年 2 月')
  app.state.calendarMonth.value = new Date(2027, 0, 31)
  app.state.changeMonth(-1)
  assert.equal(app.state.monthLabel.value, '2026 年 12 月')
})

test('第2页保存后保留页码，删除唯一一条后回退到第1页', async (t) => {
  const rows = Array.from({ length: 11 }, (_, i) => meeting(String(i)))
  const app = mount({}, rows, undefined, {
    deleteMeeting: async (id) => {
      rows.splice(
        rows.findIndex((row) => row.id === id),
        1
      )
    }
  })
  t.after(app.stop)
  await app.start()
  app.state.page.value = 2
  app.state.formRef.value = { validate: async () => true }
  app.state.openEdit(rows[10])
  await app.state.handleSubmit()
  assert.equal(app.state.page.value, 2)
  await app.state.removeMeeting(rows[10])
  assert.equal(app.state.page.value, 1)
  assert.equal(app.state.meetings.value.length, 10)
})

test('保存失败不产生未处理拒绝，表单保留且结束保存加载态', async (t) => {
  const app = mount({}, [], undefined, {
    createMeeting: async () => {
      throw new Error('400')
    }
  })
  t.after(app.stop)
  await app.start()
  app.state.formRef.value = { validate: async () => true }
  app.state.openCreate()
  app.state.form.title = '保留的主题'
  await app.state.handleSubmit()
  assert.equal(app.state.dialogVisible.value, true)
  assert.equal(app.state.form.title, '保留的主题')
  assert.equal(app.state.dialogLoading.value, false)
})
