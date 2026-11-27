/**
 * 会议视图组件测试（线③ 卡 T-2 / 卡 F-1 / PR #51 评审）。
 *
 * 覆盖「会议讨论区」的关键交互：
 *  - 打开会议详情时**自动加载**讨论区；
 *  - 会议已结束 → 输入框禁用 + 出现「只读」标记 + 不允许发消息；
 *  - 会议未结束 → 输入框可用，可以发言；
 *  - 讨论区加载失败**不阻断**会议详情展示（附加内容不该拖垮主流程），
 *    且显示「加载失败」而非「还没有人发言」；
 *  - 看过讨论区 → 标记已读；轮询拉到新消息 → 同样标记已读；
 *  - 弹窗打开期间每 30 秒轮询；关闭弹窗后停掉；已结束的会议不轮询；
 *  - 快速切换会议时丢弃过期的讨论区响应（不串台），且先清空上一场消息；
 *  - 会议已删除 → 同样只读，原因文案与「已结束」不同。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import MeetingsView from '@/views/MeetingsView.vue'

// 组件里起了 30 秒轮询定时器；不自动卸载的话，上一个用例的定时器会一直跑，
// 后面用例数到的调用次数就不准了。
enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => {
  const conversationsApi = {
    ensureMeetingConversation: vi.fn(),
    fetchMessages: vi.fn(),
    fetchMeetingDiscussionReadOnly: vi.fn(),
    sendMessage: vi.fn(),
    markRead: vi.fn()
  }
  const meetingsApi = {
    fetchMeetings: vi.fn(),
    fetchMeeting: vi.fn(),
    createMeeting: vi.fn(),
    updateMeeting: vi.fn(),
    deleteMeeting: vi.fn()
  }
  const projectsApi = { fetchProjects: vi.fn(), fetchProject: vi.fn() }
  const teamsApi = { fetchMyTeams: vi.fn(), fetchTeamMembers: vi.fn() }
  const fileApi = { uploadFile: vi.fn() }
  return { conversationsApi, meetingsApi, projectsApi, teamsApi, fileApi }
})

const { conversationsApi, meetingsApi, projectsApi, teamsApi, fileApi } = mocks

vi.mock('@/api', () => ({
  conversationsApi: mocks.conversationsApi,
  meetingsApi: mocks.meetingsApi,
  projectsApi: mocks.projectsApi,
  teamsApi: mocks.teamsApi,
  fileApi: mocks.fileApi
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ currentRoute: { value: { fullPath: '/meetings' } }, push: vi.fn(), replace: vi.fn() })
}))

const MEETING = {
  id: '7',
  projectId: '3',
  projectName: '科研项目',
  title: '第三次讨论会',
  heldAt: '2026-11-27 10:00:00',
  location: '会议室 A',
  content: '',
  status: 'ongoing',
  attendees: [],
  createdAt: '2026-11-27 09:00:00'
}

beforeEach(() => {
  vi.clearAllMocks()
  // 会议必须挂在项目下（loadMeetings 依赖 currentProjectId），所以先给一个项目
  projectsApi.fetchProjects.mockResolvedValue({
    list: [{ id: '3', name: '科研项目', teamId: '1', status: 'planning' }],
    total: 1
  })
  meetingsApi.fetchMeetings.mockResolvedValue({ list: [MEETING], total: 1 })
  meetingsApi.fetchMeeting.mockResolvedValue(MEETING)
  teamsApi.fetchMyTeams.mockResolvedValue([])
  teamsApi.fetchTeamMembers.mockResolvedValue({ list: [], total: 0 })
  projectsApi.fetchProject.mockResolvedValue({
    id: '3',
    name: '科研项目',
    teamId: '1',
    status: 'planning'
  })
  conversationsApi.ensureMeetingConversation.mockResolvedValue({
    id: '20',
    type: 'meeting',
    title: '会议「第三次讨论会」讨论区'
  })
  conversationsApi.fetchMessages.mockResolvedValue([])
  conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
    readOnly: false,
    reason: ''
  })
  conversationsApi.markRead.mockResolvedValue({ ok: true })
  fileApi.uploadFile.mockResolvedValue({ id: '88' })
  conversationsApi.sendMessage.mockResolvedValue({
    id: '900',
    conversationId: '20',
    senderId: '1',
    senderName: '我',
    content: '大家好',
    msgType: 'text',
    createdAt: '2026-11-27 10:10:00'
  })
})

async function mountView() {
  const wrapper = mount(MeetingsView, {
    global: { plugins: [createPinia(), ElementPlus] }
  })
  await flushPromises()
  return wrapper
}

/** 打开会议详情（点表格里的「详情」按钮） */
async function openDetail(wrapper: Awaited<ReturnType<typeof mountView>>) {
  const buttons = wrapper.findAll('button')
  const detailBtn = buttons.find((b) => b.text().includes('详情'))
  if (detailBtn) {
    await detailBtn.trigger('click')
    await flushPromises()
  }
}

describe('会议讨论区（T-2 / F-1）', () => {
  it('打开会议详情时自动加载讨论区', async () => {
    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(conversationsApi.ensureMeetingConversation).toHaveBeenCalledWith('7')
    expect(conversationsApi.fetchMeetingDiscussionReadOnly).toHaveBeenCalledWith('20')
    expect(wrapper.text()).toContain('讨论区')
  })

  it('会议已结束：输入框禁用 + 只读标记 + 点发送不调接口', async () => {
    conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
      readOnly: true,
      reason: '会议已结束，讨论区只读'
    })

    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(wrapper.text()).toContain('会议已结束，讨论区只读')

    // 输入框被禁用
    const textarea = wrapper.find('.discussion-input textarea')
    expect(textarea.exists()).toBe(true)
    expect(textarea.attributes('disabled')).toBeDefined()

    // 发送按钮禁用
    const sendBtn = wrapper
      .findAll('.discussion-input button')
      .find((b) => b.text().includes('发送'))
    expect(sendBtn?.attributes('disabled')).toBeDefined()

    // 即使强行触发点击也不会发请求
    await sendBtn?.trigger('click')
    await flushPromises()
    expect(conversationsApi.sendMessage).not.toHaveBeenCalled()
  })

  it('会议未结束：可以发言', async () => {
    const wrapper = await mountView()
    await openDetail(wrapper)

    const textarea = wrapper.find('.discussion-input textarea')
    expect(textarea.attributes('disabled')).toBeUndefined()

    await textarea.setValue('大家好')
    const sendBtn = wrapper
      .findAll('.discussion-input button')
      .find((b) => b.text().includes('发送'))
    await sendBtn?.trigger('click')
    await flushPromises()

    expect(conversationsApi.sendMessage).toHaveBeenCalledWith('20', '大家好', undefined)
    expect(wrapper.text()).toContain('大家好')
  })

  it('讨论区加载失败不阻断会议详情展示', async () => {
    conversationsApi.ensureMeetingConversation.mockRejectedValue(new Error('boom'))

    const wrapper = await mountView()
    await openDetail(wrapper)

    // 详情本身仍然展示
    expect(wrapper.text()).toContain('第三次讨论会')
  })

  it('讨论区加载失败时显示「加载失败」，不显示成「还没有人发言」', async () => {
    conversationsApi.ensureMeetingConversation.mockRejectedValue(new Error('boom'))

    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(wrapper.text()).toContain('讨论区加载失败')
    expect(wrapper.text()).not.toContain('还没有人发言')
  })

  it('看过讨论区后标记已读（未读数不残留）', async () => {
    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(conversationsApi.markRead).toHaveBeenCalledWith('20')
  })

  it('会议已删除：只读标记与原因都是「已删除」', async () => {
    conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
      readOnly: true,
      reason: '会议已删除，讨论区只读'
    })

    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(wrapper.text()).toContain('会议已删除，讨论区只读')
    const textarea = wrapper.find('.discussion-input textarea')
    expect(textarea.attributes('disabled')).toBeDefined()
  })

  it('打开详情期间会启动 30 秒轮询；关闭详情后停掉', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountView()
      await openDetail(wrapper)

      // 打开详情后，拉过一次消息
      const callsAfterOpen = conversationsApi.fetchMessages.mock.calls.length
      expect(callsAfterOpen).toBeGreaterThan(0)

      // 推进 30 秒 → 轮询再拉一次
      await vi.advanceTimersByTimeAsync(30_000)
      expect(conversationsApi.fetchMessages.mock.calls.length).toBeGreaterThan(
        callsAfterOpen
      )

      // 关闭弹窗 → 定时器清掉，不再拉数据。
      // el-dialog 的 @closed 在关闭动画结束后才触发，jsdom 里没有动画，
      // 所以直接 emit 事件，不依赖真实点击。
      // 注意：本页有**两个** el-dialog（创建/编辑 + 详情），
      // 绑了 @closed 的是详情那个，对准了再 emit。
      for (const dialog of wrapper.findAllComponents({ name: 'ElDialog' })) {
        if (dialog.find('.discussion').exists()) {
          dialog.vm.$emit('closed')
        }
      }
      await flushPromises()
      const callsAfterClose = conversationsApi.fetchMessages.mock.calls.length

      await vi.advanceTimersByTimeAsync(60_000)
      expect(conversationsApi.fetchMessages.mock.calls.length).toBe(callsAfterClose)
    } finally {
      vi.useRealTimers()
    }
  })

  it('轮询拉到新消息后同样标记已读（未读数不残留）', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountView()
      await openDetail(wrapper)

      conversationsApi.markRead.mockClear()
      // 轮询时拉到一条新消息
      conversationsApi.fetchMessages.mockResolvedValue([
        {
          id: '901',
          conversationId: '20',
          senderId: '2',
          senderName: '别人',
          content: '轮询拉到的新消息',
          msgType: 'text',
          createdAt: '2026-11-27 10:20:00'
        }
      ])

      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()

      expect(wrapper.text()).toContain('轮询拉到的新消息')
      expect(conversationsApi.markRead).toHaveBeenCalledWith('20')
    } finally {
      vi.useRealTimers()
    }
  })

  it('已结束的会议不轮询（只读存档不会再有新消息）', async () => {    vi.useFakeTimers()
    try {
      conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
        readOnly: true,
        reason: '会议已结束，讨论区只读'
      })

      const wrapper = await mountView()
      await openDetail(wrapper)

      const callsAfterOpen = conversationsApi.fetchMessages.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(conversationsApi.fetchMessages.mock.calls.length).toBe(callsAfterOpen)
    } finally {
      vi.useRealTimers()
    }
  })

  it('快速切换会议：过期的讨论区响应被丢弃，不串台', async () => {
    // 第一次请求慢、第二次请求快，模拟 A 会议响应后到
    let resolveFirst: ((value: unknown) => void) | undefined
    conversationsApi.ensureMeetingConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )

    const wrapper = await mountView()
    await openDetail(wrapper)

    // 切到另一个会议（第二次请求正常返回）
    conversationsApi.ensureMeetingConversation.mockResolvedValue({
      id: '21',
      type: 'meeting',
      title: '会议「B」讨论区'
    })
    meetingsApi.fetchMeeting.mockResolvedValue({ ...MEETING, id: '8', title: 'B 会议' })
    const buttons = wrapper.findAll('button')
    const detailBtn = buttons.find((b) => b.text().includes('详情'))
    await detailBtn?.trigger('click')
    await flushPromises()

    expect(conversationsApi.fetchMessages).toHaveBeenCalledWith('21', 200)

    // 现在 A 的响应才回来 —— 不能把 A 的讨论区盖到 B 上
    resolveFirst?.({
      id: '20',
      type: 'meeting',
      title: '会议「A」讨论区'
    })
    await flushPromises()

    const textarea = wrapper.find('.discussion-input textarea')
    await textarea.setValue('B 会议发言')
    const sendBtn = wrapper
      .findAll('.discussion-input button')
      .find((b) => b.text().includes('发送'))
    await sendBtn?.trigger('click')
    await flushPromises()

    // 发言必须发到 B 的会话，而不是 A 的
    expect(conversationsApi.sendMessage).toHaveBeenCalledWith(
      '21',
      'B 会议发言',
      undefined
    )
  })

  /**
   * 评审的用例缺口：加载讨论区前不清上一场消息没有用例（对应 A6 串台）。
   *
   * 切到另一场会议时，上一场的消息必须**先清空**再加载，
   * 否则在新会议详情里会短暂看到上一场的消息。
   */
  it('切换会议时先清空上一场的讨论消息', async () => {
    conversationsApi.fetchMessages.mockResolvedValue([
      {
        id: '901',
        conversationId: '20',
        senderId: '2',
        senderName: '别人',
        content: 'A 会议里的话',
        msgType: 'text',
        createdAt: '2026-11-27 10:20:00'
      }
    ])

    const wrapper = await mountView()
    await openDetail(wrapper)
    expect(wrapper.text()).toContain('A 会议里的话')

    // 切到另一场会议，且新会议的消息**还在路上**
    conversationsApi.fetchMessages.mockReturnValue(
      new Promise(() => {
        /* 永不 resolve，模拟慢响应 */
      })
    )
    meetingsApi.fetchMeeting.mockResolvedValue({ ...MEETING, id: '8', title: 'B 会议' })
    const buttons = wrapper.findAll('button')
    const detailBtn = buttons.find((b) => b.text().includes('详情'))
    await detailBtn?.trigger('click')
    await flushPromises()

    // A 会议的消息不该还留在页面上
    expect(wrapper.text()).not.toContain('A 会议里的话')
  })
})
