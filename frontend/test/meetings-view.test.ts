/**
 * 会议视图组件测试（线③ 卡 T-2 / 卡 F-1）。
 *
 * 覆盖「会议讨论区」的关键交互：
 *  - 打开会议详情时**自动加载**讨论区；
 *  - 会议已结束 → 输入框禁用 + 出现「只读」标记 + 不允许发消息；
 *  - 会议未结束 → 输入框可用，可以发言；
 *  - 讨论区加载失败**不阻断**会议详情展示（附加内容不该拖垮主流程）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import MeetingsView from '@/views/MeetingsView.vue'

const mocks = vi.hoisted(() => {
  const conversationsApi = {
    ensureMeetingConversation: vi.fn(),
    fetchMessages: vi.fn(),
    fetchMeetingDiscussionReadOnly: vi.fn(),
    sendMessage: vi.fn()
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
  return { conversationsApi, meetingsApi, projectsApi, teamsApi }
})

const { conversationsApi, meetingsApi, projectsApi, teamsApi } = mocks

vi.mock('@/api', () => ({
  conversationsApi: mocks.conversationsApi,
  meetingsApi: mocks.meetingsApi,
  projectsApi: mocks.projectsApi,
  teamsApi: mocks.teamsApi
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
  conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({ readOnly: false })
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
    conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({ readOnly: true })

    const wrapper = await mountView()
    await openDetail(wrapper)

    expect(wrapper.text()).toContain('会议已结束，只读')

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

    expect(conversationsApi.sendMessage).toHaveBeenCalledWith('20', '大家好')
    expect(wrapper.text()).toContain('大家好')
  })

  it('讨论区加载失败不阻断会议详情展示', async () => {
    conversationsApi.ensureMeetingConversation.mockRejectedValue(new Error('boom'))

    const wrapper = await mountView()
    await openDetail(wrapper)

    // 详情本身仍然展示
    expect(wrapper.text()).toContain('第三次讨论会')
  })
})
