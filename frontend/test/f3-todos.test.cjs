/** F-3：固定时钟 + 真实聚合/分页/模板；只在 API 边界打桩。 */
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  fixedDate,
  loadUtils,
  makeApi,
  mountDashboard,
  mountBoard,
  task
} = require('./helpers/f3-harness.cjs')

const NOW = new Date(2026, 10, 27, 1, 0)
const ids = (rows) => Array.from(rows, (row) => row.id)

function paginate(rows, page, size) {
  return { list: rows.slice((page - 1) * size, page * size), total: rows.length }
}

test('归属过滤排除他人、已完成、未指派；保留跨项目 todo/doing', () => {
  const utils = loadUtils(makeApi(), fixedDate(NOW))
  const rows = [
    task('mine-a'),
    task('mine-b', { projectId: 'p2', status: 'doing' }),
    task('other', { assigneeId: 'u2' }),
    task('done', { status: 'done' }),
    task('unassigned', { assigneeId: '' })
  ]
  assert.deepEqual(ids(utils.selectMyTasks(rows, 'u1')), ['mine-a', 'mine-b'])
  assert.deepEqual(ids(utils.selectMyTasks(rows)), [])
  assert.equal(rows.length, 5)
})

test('没有 userId 时待办为空，且不发任务请求', async () => {
  const api = makeApi()
  const utils = loadUtils(api, fixedDate(NOW))
  assert.deepEqual(ids(await utils.loadMyTasks()), [])
  assert.equal(api.tasksApi.fetchTasks.mock.callCount(), 0)
})

test('我的任务用 assigneeId 跨项目查询，107 条翻两页且第二页参与过滤', async () => {
  const rows = Array.from({ length: 107 }, (_, i) => task(String(i), { projectId: `p${i}` }))
  rows[103] = task('done', { status: 'done' })
  rows[104] = task('other', { assigneeId: 'u2' })
  rows[105] = task('unassigned', { assigneeId: '' })
  const api = makeApi({ fetchTasks: async ({ page, size }) => paginate(rows, page, size) })
  const utils = loadUtils(api, fixedDate(NOW))
  const result = await utils.loadMyTasks('u1')
  assert.equal(result.length, 104)
  assert.ok(ids(result).includes('106'))
  assert.ok(!ids(result).includes('done'))
  assert.ok(!ids(result).includes('other'))
  assert.ok(!ids(result).includes('unassigned'))
  assert.equal(api.tasksApi.fetchTasks.mock.callCount(), 2)
  for (const [i, call] of api.tasksApi.fetchTasks.mock.calls.entries()) {
    const query = call.arguments[0]
    assert.equal(query.assigneeId, 'u1')
    assert.equal(query.page, i + 1)
    assert.equal(query.size, 100)
    assert.equal(query.projectId, undefined)
    assert.equal(query.mine, undefined)
  }
  // 待办不依赖只取前 100 项的 /projects，也不扩大项目概览统计范围。
  assert.equal(api.projectsApi.fetchProjects.mock.callCount(), 0)
})

test('分页读到空页即可结束，且不会掩盖下一页请求失败', async () => {
  const api = makeApi({ fetchTasks: async () => ({ list: [], total: 500 }) })
  const utils = loadUtils(api, fixedDate(NOW))
  assert.equal((await utils.fetchAllTasks({ projectId: 'p1' })).length, 0)
  assert.equal(api.tasksApi.fetchTasks.mock.callCount(), 1)
  const broken = makeApi({
    fetchTasks: async ({ page }) => {
      if (page === 2) throw new Error('second-page-error')
      return { list: Array.from({ length: 100 }, (_, i) => task(String(i))), total: 107 }
    }
  })
  await assert.rejects(loadUtils(broken).fetchAllTasks({ projectId: 'p1' }), /second-page-error/)
})

test('全部按截止日期升序，同日期按标题排序，无日期置底且不改输入数组', () => {
  const utils = loadUtils(makeApi(), fixedDate(NOW))
  const rows = [
    task('none'),
    task('z', { dueDate: '2026-11-27', title: 'Z' }),
    task('later', { dueDate: '2099-01-01' }),
    task('a', { dueDate: '2026-11-27', title: 'A' }),
    task('old', { dueDate: '2020-01-01' })
  ]
  const before = ids(rows)
  assert.deepEqual(ids(utils.filterMyTasks(rows, 'all')), ['old', 'a', 'z', 'later', 'none'])
  assert.deepEqual(ids(rows), before)
})

// 用例日期是固定时钟的输入，不与运行用例当天的真实日期比较。
for (const boundary of [
  {
    name: '周五凌晨',
    now: new Date(2026, 10, 27, 0, 30),
    today: '2026-11-27',
    yesterday: '2026-11-26',
    end: '2026-11-29',
    outside: '2026-11-30'
  },
  {
    name: '周日',
    now: new Date(2026, 10, 29, 23, 30),
    today: '2026-11-29',
    yesterday: '2026-11-28',
    end: '2026-11-29',
    outside: '2026-11-30'
  },
  {
    name: '周一',
    now: new Date(2026, 10, 30, 0, 30),
    today: '2026-11-30',
    yesterday: '2026-11-29',
    end: '2026-12-06',
    outside: '2026-12-07'
  },
  {
    name: '跨年周',
    now: new Date(2026, 11, 31, 1),
    today: '2026-12-31',
    yesterday: '2026-12-30',
    end: '2027-01-03',
    outside: '2027-01-04'
  }
]) {
  test(`固定时钟：${boundary.name}，本周上下界闭合，昨天逾期、下周排除`, () => {
    const utils = loadUtils(makeApi(), fixedDate(boundary.now))
    const rows = [
      task('yesterday', { dueDate: boundary.yesterday }),
      task('today', { dueDate: boundary.today }),
      task('sunday', { dueDate: boundary.end }),
      task('next-week', { dueDate: boundary.outside }),
      task('none')
    ]
    assert.equal(utils.today(), boundary.today)
    assert.deepEqual(ids(utils.filterMyTasks(rows, 'overdue')), ['yesterday'])
    // 相同截止日期按任务标题排序（sunday/today）。
    const expected = boundary.today === boundary.end ? ['sunday', 'today'] : ['today', 'sunday']
    assert.deepEqual(ids(utils.filterMyTasks(rows, 'week')), expected)
  })
}

test('凌晨 1 点：共享日期/横幅/卡片/里程碑同口径；今天和已完成不逾期', async (t) => {
  const yesterday = task('yesterday', { dueDate: '2026-11-26' })
  const today = task('today', { dueDate: '2026-11-27' })
  const done = task('done', { dueDate: '2026-11-26', status: 'done' })
  const app = mountDashboard([], {
    now: NOW,
    projects: [{ id: 'p1', name: '项目一' }],
    fetchTasks: async () => ({ list: [yesterday, today, done], total: 3 })
  })
  t.after(app.stop)
  await app.start()
  assert.equal(app.utils.today(), '2026-11-27')
  assert.equal(app.utils.isTaskOverdue(yesterday), true)
  assert.equal(app.utils.isTaskOverdue(today), false)
  assert.equal(app.utils.isTaskOverdue(done), false)
  assert.equal(app.utils.isMilestoneOverdue({ dueDate: yesterday.dueDate, status: 'todo' }), true)
  assert.equal(app.utils.isMilestoneOverdue({ dueDate: yesterday.dueDate, status: 'done' }), false)
  assert.equal(app.state.overdueTasks.value, 1)
  app.state.todoFilter.value = 'overdue'
  assert.deepEqual(ids(app.state.filteredMyTasks.value), ['yesterday'])
  const html = await app.html()
  assert.match(html, /class="todo-due is-overdue"[^>]*>\s*已逾期 2026-11-26/)
  app.state.todoFilter.value = 'all'
  const all = await app.html()
  assert.match(all, /class="todo-due"[^>]*>\s*2026-11-27/)
})

test('临期 3 天也使用本地日期，跨年第四天不纳入', () => {
  const utils = loadUtils(makeApi(), fixedDate(new Date(2026, 11, 31, 1)))
  assert.equal(utils.isTaskDueSoon(task('today', { dueDate: '2026-12-31' })), true)
  assert.equal(utils.isTaskDueSoon(task('end', { dueDate: '2027-01-03' })), true)
  assert.equal(utils.isTaskDueSoon(task('outside', { dueDate: '2027-01-04' })), false)
  assert.equal(utils.isTaskDueSoon(task('old', { dueDate: '2026-12-30' })), false)
})

test('Dashboard 把 store.userInfo.id 传入真实加载器，不请求 /auth/me', async (t) => {
  const app = mountDashboard([], {
    now: NOW,
    userInfo: { id: 'u7' },
    fetchTasks: async ({ assigneeId }) => {
      assert.equal(assigneeId, 'u7')
      return { list: [task('mine', { assigneeId: 'u7', projectId: 'p107' })], total: 1 }
    }
  })
  t.after(app.stop)
  await app.start()
  assert.equal(app.api.tasksApi.fetchTasks.mock.callCount(), 1)
  assert.equal(app.api.authApi.fetchMe.mock.callCount(), 0)
  assert.deepEqual(ids(app.state.myTasks.value), ['mine'])
})

test('没有用户信息时先 /auth/me，再按返回 id 取待办', async (t) => {
  const events = []
  const app = mountDashboard([], {
    now: NOW,
    userInfo: null,
    fetchMe: async () => {
      events.push('me')
      return { id: 'u8' }
    },
    fetchTasks: async ({ assigneeId }) => {
      events.push(`tasks:${assigneeId}`)
      return { list: [task('mine', { assigneeId: 'u8' })], total: 1 }
    }
  })
  t.after(app.stop)
  await app.start()
  assert.deepEqual(events, ['me', 'tasks:u8'])
  assert.equal(app.user.userInfo.id, 'u8')
  assert.deepEqual(ids(app.state.myTasks.value), ['mine'])
})

test('/auth/me 失败只影响待办，横幅与会议仍加载', async (t) => {
  const app = mountDashboard([{ id: 'near', heldAt: '2026-11-27 09:30:00' }], {
    now: NOW,
    userInfo: null,
    projects: [{ id: 'p1', name: '项目一' }],
    fetchMe: async () => {
      throw new Error('auth-fail')
    },
    fetchTasks: async ({ projectId }) => {
      assert.equal(projectId, 'p1')
      return { list: [task('old', { dueDate: '2026-11-26' })], total: 1 }
    }
  })
  t.after(app.stop)
  await app.start()
  assert.equal(app.state.overdueTasks.value, 1)
  assert.equal(app.state.todosLoading.value, false)
  assert.equal(app.state.todosFailed.value, true)
  assert.deepEqual(ids(app.state.recentMeetings.value), ['near'])
})

test('汇总请求失败不影响待办；已完成/他人任务不能混入真实页面状态', async (t) => {
  const app = mountDashboard([], {
    now: NOW,
    projects: [{ id: 'p1' }],
    fetchTasks: async ({ assigneeId }) => {
      if (!assigneeId) throw new Error('summary-fail')
      return {
        list: [task('mine'), task('done', { status: 'done' }), task('other', { assigneeId: 'u2' })],
        total: 3
      }
    }
  })
  t.after(app.stop)
  await app.start()
  assert.deepEqual(ids(app.state.myTasks.value), ['mine'])
  assert.equal(app.state.todosFailed.value, false)
})

test('点击待办调用一次路由，携带对应项目 id', async (t) => {
  const app = mountDashboard([], {
    now: NOW,
    fetchTasks: async () => ({ list: [task('mine', { projectId: 'project-7' })], total: 1 })
  })
  t.after(app.stop)
  await app.start()
  app.state.openTaskBoard(app.state.myTasks.value[0])
  assert.equal(app.router.push.mock.callCount(), 1)
  const target = app.router.push.mock.calls[0].arguments[0]
  assert.equal(target.path, '/tasks')
  assert.equal(target.query.projectId, 'project-7')
})

test('加载期间不显示空态；失败可重试，重试成功后显示空态', async (t) => {
  let rejectFirst
  const first = new Promise((_, reject) => {
    rejectFirst = reject
  })
  let calls = 0
  const app = mountDashboard([], {
    now: NOW,
    fetchTasks: async () => {
      if (calls++ === 0) return first
      return { list: [], total: 0 }
    }
  })
  t.after(app.stop)
  const pending = app.start()
  assert.equal(app.state.todosLoading.value, true)
  const loading = await app.html()
  assert.match(loading, /正在加载待办任务/)
  assert.doesNotMatch(loading, /description="当前筛选下没有待办任务"/)
  rejectFirst(new Error('network'))
  await pending
  assert.equal(app.state.todosFailed.value, true)
  await app.state.loadTodos()
  assert.equal(app.state.todosLoading.value, false)
  assert.equal(app.state.todosFailed.value, false)
  assert.match(await app.html(), /description="当前筛选下没有待办任务"/)
})

test('看板复用分页读取，第 107 条落入正确列；mine 参数现状保持不变', async (t) => {
  const rows = Array.from({ length: 107 }, (_, i) =>
    task(String(i), { status: i === 106 ? 'doing' : 'todo' })
  )
  const api = makeApi({
    fetchTasks: async ({ projectId, mine, page, size }) => {
      assert.equal(projectId, 'p1')
      assert.equal(mine, undefined)
      return paginate(rows, page, size)
    }
  })
  const board = mountBoard(api, NOW)
  t.after(board.stop)
  board.state.currentProjectId.value = 'p1'
  await board.state.loadTasks()
  assert.equal(api.tasksApi.fetchTasks.mock.callCount(), 2)
  assert.equal(board.state.tasks.value.length, 107)
  assert.deepEqual(ids(board.state.columns.value.doing), ['106'])
  assert.equal(board.state.loading.value, false)
  assert.equal(board.state.isTaskOverdue(task('old', { dueDate: '2026-11-26' })), true)
  assert.equal(board.state.isTaskOverdue(task('today', { dueDate: '2026-11-27' })), false)
})
