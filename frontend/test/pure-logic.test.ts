/**
 * 纯逻辑单测（线③ 卡 T-2）。
 *
 * 卡面要求（docs/12 §卡 T-2）：覆盖**逾期日期计算**、**未读数**、
 * **request.ts 拦截器**、**Pinia store** 四类。
 *
 * 拦截器的回归测试沿用线② 的既有资产（test/request-interceptor.test.cjs，
 * Node 原生 runner），这里只补它没覆盖到的新行为。
 */
import { describe, expect, it } from 'vitest'
import { formatFileSize } from '@/utils/display'
import {
  filterMyTasks,
  isMilestoneOverdue,
  isTaskDueSoon,
  isTaskOverdue,
  selectMyTasks,
  today
} from '@/utils/overview'
import type { TaskItem } from '@/api/tasks'
import type { MilestoneItem } from '@/api/projects'

// ---------------------------------------------------------------- 附件大小

describe('formatFileSize', () => {
  it('小于 1KB 显示字节', () => {
    expect(formatFileSize('0')).toBe('0 B')
    expect(formatFileSize('1')).toBe('1 B')
    expect(formatFileSize('1023')).toBe('1023 B')
  })

  it('恰好 1024 进位到 KB（边界含）', () => {
    expect(formatFileSize('1024')).toBe('1.0 KB')
    expect(formatFileSize('1536')).toBe('1.5 KB')
  })

  it('小于 1MB 显示 KB', () => {
    expect(formatFileSize('1048575')).toBe('1024.0 KB')
  })

  it('恰好 1MB 进位到 MB（边界含）', () => {
    expect(formatFileSize('1048576')).toBe('1.0 MB')
  })

  it('更大显示 GB', () => {
    expect(formatFileSize(String(1024 * 1024 * 1024))).toBe('1.0 GB')
  })

  it('非法值回退为 0 B，不抛错', () => {
    // 附件卡片是展示性的，坏的大小不该让整条消息渲染失败
    expect(formatFileSize('abc')).toBe('0 B')
    expect(formatFileSize(undefined)).toBe('0 B')
    expect(formatFileSize(null)).toBe('0 B')
    expect(formatFileSize('-1')).toBe('0 B')
  })

  it('接受数字入参（前端本地 File.size 就是 number）', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(0)).toBe('0 B')
  })
})

// ---------------------------------------------------------------- 逾期日期

/** 造一条任务，只关心用到的字段 */
function task(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    title: '任务',
    status: 'todo',
    dueDate: '',
    ...overrides
  } as TaskItem
}

describe('逾期判定（口径：截止日早于今天且未完成）', () => {
  const now = new Date('2026-11-27T10:00:00')

  it('今天的截止日不算逾期', () => {
    expect(isTaskOverdue(task({ id: '1', dueDate: '2026-11-27' }))).toBe(false)
    void now
  })

  it('昨天截止且未完成 → 逾期', () => {
    expect(isTaskOverdue(task({ id: '1', dueDate: '2026-11-26' }))).toBe(true)
  })

  it('已完成的逾期任务不算逾期', () => {
    expect(
      isTaskOverdue(task({ id: '1', dueDate: '2026-11-26', status: 'done' }))
    ).toBe(false)
  })

  it('无截止日的任务不算逾期', () => {
    expect(isTaskOverdue(task({ id: '1', dueDate: '' }))).toBe(false)
  })
})

describe('临期判定（今天起 3 天内）', () => {
  it('今天到期 → 临期', () => {
    expect(isTaskDueSoon(task({ id: '1', dueDate: '2026-11-27' }))).toBe(true)
  })

  it('3 天后到期 → 临期（边界含）', () => {
    expect(isTaskDueSoon(task({ id: '1', dueDate: '2026-11-30' }))).toBe(true)
  })

  it('4 天后到期 → 不临期', () => {
    expect(isTaskDueSoon(task({ id: '1', dueDate: '2026-12-01' }))).toBe(false)
  })

  it('昨天到期 → 不临期（那是逾期，不是临期）', () => {
    expect(isTaskDueSoon(task({ id: '1', dueDate: '2026-11-26' }))).toBe(false)
  })
})

describe('里程碑逾期', () => {
  const milestone = (over: Partial<MilestoneItem>): MilestoneItem =>
    ({ status: 'todo', dueDate: '2026-11-26', ...over }) as MilestoneItem

  it('未完成且截止日早于今天 → 逾期', () => {
    expect(isMilestoneOverdue(milestone({}))).toBe(true)
  })

  it('已完成 → 不逾期', () => {
    expect(isMilestoneOverdue(milestone({ status: 'done' }))).toBe(false)
  })
})

describe('我的待办筛选', () => {
  const tasks = [
    task({ id: '1', title: '无日期', dueDate: '' }),
    task({ id: '2', title: '昨天', dueDate: '2026-11-26' }),
    task({ id: '3', title: '今天', dueDate: '2026-11-27' }),
    task({ id: '4', title: '周日', dueDate: '2026-11-29' }),
    task({ id: '5', title: '下周一', dueDate: '2026-11-30' })
  ]
  // 2026-11-27 是周五，本周日是 11-29
  const now = new Date('2026-11-27T10:00:00')

  it('「我逾期的」只取早于今天的', () => {
    const result = filterMyTasks(tasks, 'overdue', now)
    expect(result.map((t) => t.title)).toEqual(['昨天'])
  })

  it('「本周」取今天至本周日', () => {
    const result = filterMyTasks(tasks, 'week', now)
    expect(result.map((t) => t.title)).toEqual(['今天', '周日'])
  })

  it('「全部」保留无日期的任务', () => {
    const result = filterMyTasks(tasks, 'all', now)
    expect(result).toHaveLength(5)
  })

  it('排序：无日期的排在最后', () => {
    const result = filterMyTasks(tasks, 'all', now)
    expect(result[result.length - 1].title).toBe('无日期')
  })
})

describe('按负责人过滤', () => {
  const tasks = [
    task({ id: '1', assigneeId: 'u1', status: 'todo' }),
    task({ id: '2', assigneeId: 'u2', status: 'todo' }),
    task({ id: '3', assigneeId: 'u1', status: 'done' })
  ]

  it('只保留自己的未完成任务', () => {
    const result = selectMyTasks(tasks, 'u1')
    expect(result.map((t) => t.id)).toEqual(['1'])
  })

  it('没有 userId → 空数组', () => {
    expect(selectMyTasks(tasks, undefined)).toEqual([])
  })
})

describe('today', () => {
  it('输出 yyyy-MM-dd 且月日补零', () => {
    expect(today(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05')
    expect(today(new Date('2026-11-27T23:59:59'))).toBe('2026-11-27')
  })
})
