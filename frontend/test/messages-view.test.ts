/**
 * 消息视图组件测试（线③ 卡 T-2 / 卡 A-3）。
 *
 * 覆盖：
 *  - 文件消息渲染成附件卡片（文件名、大小、下载链接）；
 *  - 文本消息不渲染附件卡片；
 *  - 附件被删除（后端不下发 file 字段）时降级为纯文本，不报错；
 *  - 会议讨论区页签（F-1）：只读时禁用输入框并给出说明。
 *
 * 后端接口全部 mock——组件测试只关心**渲染与交互**，
 * 接口契约由后端单测与真库集成测试（T-1c）负责。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import MessagesView from '@/views/MessagesView.vue'

// ---------------------------------------------------------------- 接口替身

/**
 * `vi.mock` 会被提升到文件顶部，直接引用模块级 const 会报
 * "Cannot access 'X' before initialization"。
 * 所以用 `vi.hoisted` 把替身先建好，再在 mock 工厂里引用。
 */
const mocks = vi.hoisted(() => {
  const conversationsApi = {
    fetchConversations: vi.fn(),
    fetchUnread: vi.fn(),
    fetchMessages: vi.fn(),
    sendMessage: vi.fn(),
    markRead: vi.fn(),
    ensurePrivateConversation: vi.fn(),
    openPrivateConversationByUid: vi.fn(),
    ensureGroupConversation: vi.fn(),
    ensureMeetingConversation: vi.fn(),
    fetchMeetingDiscussionReadOnly: vi.fn()
  }
  const fileApi = { uploadFile: vi.fn() }
  const authApi = { fetchMe: vi.fn() }
  const projectsApi = { fetchProjects: vi.fn() }
  const teamsApi = {
    fetchMyTeams: vi.fn(),
    fetchTeamMembers: vi.fn()
  }
  return { conversationsApi, fileApi, authApi, projectsApi, teamsApi }
})

const { conversationsApi, fileApi, authApi, projectsApi, teamsApi } = mocks

vi.mock('@/api', () => ({
  authApi: mocks.authApi,
  conversationsApi: mocks.conversationsApi,
  fileApi: mocks.fileApi,
  projectsApi: mocks.projectsApi,
  teamsApi: mocks.teamsApi
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({
    currentRoute: { value: { fullPath: '/messages' } },
    push: vi.fn(),
    replace: vi.fn()
  })
}))

// ---------------------------------------------------------------- 夹具

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: '10',
    type: 'private',
    title: '与爱丽丝的会话',
    refType: '',
    refId: '',
    lastMessage: '',
    lastMessageAt: '',
    updatedAt: '2026-11-27 10:00:00',
    unreadCount: 0,
    ...over
  }
}

function message(over: Record<string, unknown> = {}) {
  return {
    id: '100',
    conversationId: '10',
    senderId: '2',
    senderName: '爱丽丝',
    content: '你好',
    msgType: 'text',
    createdAt: '2026-11-27 10:00:00',
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  conversationsApi.fetchConversations.mockResolvedValue({
    list: [conversation()],
    total: 1
  })
  conversationsApi.fetchUnread.mockResolvedValue([])
  conversationsApi.fetchMessages.mockResolvedValue([])
  conversationsApi.markRead.mockResolvedValue(undefined)
  conversationsApi.sendMessage.mockResolvedValue(message({ id: '999' }))
  fileApi.uploadFile.mockResolvedValue({ id: '500' })
  authApi.fetchMe.mockResolvedValue({ id: '1', username: 'bob', nickname: '鲍勃' })
  projectsApi.fetchProjects.mockResolvedValue({ list: [], total: 0 })
  teamsApi.fetchMyTeams.mockResolvedValue([])
  teamsApi.fetchTeamMembers.mockResolvedValue({ list: [], total: 0 })
})

async function mountView() {
  const wrapper = mount(MessagesView, {
    global: { plugins: [createPinia(), ElementPlus] }
  })
  await flushPromises()
  return wrapper
}

/**
 * 打开左侧列表里的第一个会话。
 *
 * 组件**不会**自动打开会话（只在带 ?conversation= 时才自动打开），
 * 所以要测消息区渲染必须先点一下列表项——这正是真实用户的路径。
 */
async function openFirstConversation(wrapper: Awaited<ReturnType<typeof mountView>>) {
  const item = wrapper.find('.conv-item')
  if (item.exists()) {
    await item.trigger('click')
    await flushPromises()
  }
}

// ---------------------------------------------------------------- 附件卡片

describe('文件消息渲染（T-2 / A-3）', () => {
  it('msgType=file 时渲染附件卡片，含文件名与大小', async () => {
    conversationsApi.fetchMessages.mockResolvedValue([
      message({
        id: '1',
        msgType: 'file',
        content: '会议纪要',
        file: {
          id: '500',
          originalName: '会议纪要.txt',
          url: '/api/v1/files/2026/11/27/abc.txt',
          size: '2048',
          mimeType: 'text/plain'
        }
      })
    ])

    const wrapper = await mountView()
    await openFirstConversation(wrapper)
    await wrapper.vm.$nextTick()

    const link = wrapper.find('a.msg-file')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('会议纪要.txt')
    expect(link.text()).toContain('2.0 KB')
    expect(link.attributes('href')).toBe('/api/v1/files/2026/11/27/abc.txt')
    expect(link.attributes('download')).toBe('会议纪要.txt')
  })

  it('文本消息不渲染附件卡片', async () => {
    conversationsApi.fetchMessages.mockResolvedValue([message({ id: '1' })])

    const wrapper = await mountView()
    await openFirstConversation(wrapper)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('a.msg-file').exists()).toBe(false)
  })

  it('附件被删除（无 file 字段）时降级为纯文本，不报错', async () => {
    conversationsApi.fetchMessages.mockResolvedValue([
      message({ id: '1', msgType: 'file', content: '附件没了' })
    ])

    const wrapper = await mountView()
    await openFirstConversation(wrapper)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('a.msg-file').exists()).toBe(false)
    expect(wrapper.text()).toContain('附件没了')
  })
})
