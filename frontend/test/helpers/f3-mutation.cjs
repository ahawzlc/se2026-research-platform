/** 仅在 Ubuntu 手工执行：node test/helpers/f3-mutation.cjs。每轮 finally 恢复源文件。 */
/* global require, __dirname, process, console */
/* eslint-disable @typescript-eslint/no-require-imports -- Node 手工变异验证 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const frontend = path.resolve(__dirname, '../..')

function run() {
  const result = spawnSync(process.execPath, ['--test', 'test/f3-todos.test.cjs'], {
    cwd: frontend,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Asia/Shanghai' },
    timeout: 60000
  })
  if (result.error || result.signal) throw result.error ?? new Error(`进程被 ${result.signal} 中止`)
  return result
}

function main() {
  const baseline = run()
  if (baseline.status !== 0)
    throw new Error(`先修复未变异的基线：\n${baseline.stdout}\n${baseline.stderr}`)
  const utils = 'src/utils/overview.ts'
  const dashboard = 'src/views/DashboardView.vue'
  const mutations = [
    ['取消负责人过滤', utils, 'task.assigneeId === userId && ', ''],
    [
      '带入已完成任务',
      utils,
      "task.assigneeId === userId && task.status !== 'done'",
      'task.assigneeId === userId'
    ],
    ['只读第一页', utils, 'all.push(...result.list)', 'all.push(...result.list); return all'],
    ['不传当前用户 id', dashboard, 'loadMyTasks(userStore.userInfo?.id)', 'loadMyTasks()'],
    [
      '取消逾期红标 class',
      dashboard,
      ':class="{ \'is-overdue\': isTaskOverdue(task) }"',
      ':class="{ \'is-overdue\': false }"'
    ],
    [
      '本地日期退回 UTC',
      utils,
      /export function today\(date = new Date\(\)\): string \{[\s\S]*?\n\}/,
      'export function today(date = new Date()): string { return date.toISOString().slice(0, 10) }'
    ],
    [
      '截止日排序反向',
      utils,
      'a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title)',
      'b.dueDate.localeCompare(a.dueDate) || a.title.localeCompare(b.title)'
    ],
    ['本周取消上限', utils, ' && task.dueDate <= end', '']
  ]
  let missed = 0
  for (const [name, relative, before, after] of mutations) {
    const file = path.join(frontend, relative)
    const original = fs.readFileSync(file, 'utf8')
    const mutated = original.replace(before, after)
    if (mutated === original) throw new Error(`未找到变异位置：${name}`)
    let result
    try {
      fs.writeFileSync(file, mutated)
      result = run()
    } finally {
      fs.writeFileSync(file, original)
    }
    if (result.status === 0) {
      missed += 1
      console.error(`未拦住：${name}`)
    } else {
      console.log(`已拦住：${name}`)
    }
  }
  if (missed) throw new Error(`${missed} 个变体漏过；源文件已恢复`)
  console.log(`全部 ${mutations.length} 个变体被拦住；源文件已恢复`)
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
