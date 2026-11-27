/** F-2 工作台真实 SFC 回归；共享 F-3 的 API 边界沙箱。 */
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 原生测试 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mountDashboard: mount } = require('./helpers/f3-harness.cjs')

function meeting(id, hours) {
  const date = new Date(Date.now() + hours * 3_600_000 + 8 * 3_600_000)
  return { id, title: id, heldAt: date.toISOString().slice(0, 19).replace('T', ' ') }
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
