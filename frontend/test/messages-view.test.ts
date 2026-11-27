/**
 * 消息视图组件测试（线③ 卡 T-2 / 卡 A-3 / PR #51 评审）。
 *
 * 覆盖：
 *  - 文件消息渲染成附件卡片（文件名、大小、下载链接）；
 *  - 文本消息不渲染附件卡片；
 *  - 附件被删除（后端不下发 file 字段）时降级为纯文本，不报错；
 *  - 会议讨论区（F-1）：只读时禁用输入框并给出说明；非会议会话不查只读接口；
 *    会话类型为 meeting 时能渲染出类型标签（TYPE_META 必须含 meeting）；
 *  - 选附件 → 上传 → 带 fileId 发消息的完整链路；
 *  - 发消息失败时保留已上传的 fileId 供重试，不重传（不产生孤儿文件）。
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

// ---------------------------------------------------------------- 只读会话

describe('会议讨论区在消息页的只读处理（PR #51 评审）', () => {
  const meetingConv = conversation({
    id: '20',
    type: 'meeting',
    title: '会议「第三次讨论会」讨论区'
  })

  it('只读会议讨论区：输入框禁用 + 给出说明 + 不发消息请求', async () => {
    conversationsApi.fetchConversations.mockResolvedValue({
      list: [meetingConv],
      total: 1
    })
    conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
      readOnly: true,
      reason: '会议已结束，讨论区只读'
    })

    const wrapper = await mountView()
    await openFirstConversation(wrapper)

    expect(wrapper.text()).toContain('会议已结束，讨论区只读')
    const textarea = wrapper.find('.msg-input textarea')
    expect(textarea.attributes('disabled')).toBeDefined()

    // 强行触发也不该发请求
    await textarea.setValue('想说点什么')
    const sendBtn = wrapper.findAll('.msg-input button').find((b) => b.text().includes('发送'))
    await sendBtn?.trigger('click')
    await flushPromises()
    expect(conversationsApi.sendMessage).not.toHaveBeenCalled()
    // 附件按钮也禁用：不然用户还能选文件
    const uploadBtn = wrapper.findAll('.msg-upload button')[0]
    expect(uploadBtn.attributes('disabled')).toBeDefined()
  })

  it('非会议会话不查只读接口，也不锁输入框', async () => {
    const wrapper = await mountView()
    await openFirstConversation(wrapper)

    expect(conversationsApi.fetchMeetingDiscussionReadOnly).not.toHaveBeenCalled()
    expect(wrapper.find('.msg-input textarea').attributes('disabled')).toBeUndefined()
  })

  /**
   * 评审的用例缺口：`TYPE_META` 里去掉 `meeting` 没有用例拦。
   *
   * 去掉以后消息页渲染会议讨论区那一行会直接抛
   * `Cannot read properties of undefined (reading 'tag')`——白屏。
   * 这里钉住：会议讨论区这一行必须能渲染出类型标签。
   */
  it('会话类型为 meeting 时能渲染出类型标签（TYPE_META 必须含 meeting）', async () => {
    conversationsApi.fetchConversations.mockResolvedValue({
      list: [meetingConv],
      total: 1
    })
    conversationsApi.fetchMeetingDiscussionReadOnly.mockResolvedValue({
      readOnly: false,
      reason: ''
    })

    const wrapper = await mountView()
    await openFirstConversation(wrapper)

    expect(wrapper.text()).toContain('会议讨论区')
    // 类型标签渲染出来了，没有因为缺 key 而抛错
    expect(wrapper.find('.conv-line .el-tag').exists()).toBe(true)
  })
})

// ---------------------------------------------------------------- 孤儿文件

describe('发消息失败不产生孤儿文件（PR #51 评审）', () => {
  it('上传成功但发消息失败：重试时复用已上传的 fileId，不重复上传', async () => {
    conversationsApi.fetchConversations.mockResolvedValue({
      list: [conversation()],
      total: 1
    })
    conversationsApi.sendMessage
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(message({ id: '999' }))

    const wrapper = await mountView()
    await openFirstConversation(wrapper)

    // 选一个附件。el-upload 的 on-change 是 **prop**（不是 emit），
    // 所以直接调 prop，而不是 vm.$emit('change')。
    const upload = wrapper.findComponent({ name: 'ElUpload' })
    const onChange = (upload.props() as Record<string, unknown>)['onChange'] as
      | ((f: unknown) => void)
      | undefined
    expect(typeof onChange).toBe('function')
    onChange?.({ raw: new File(['x'], 'a.txt') })
    await flushPromises()

    // 第一次发送：上传 + 发消息失败
    const textarea = wrapper.find('.msg-input textarea')
    await textarea.setValue('带附件的消息')
    const sendBtn = wrapper.findAll('.msg-input button').find((b) => b.text().includes('发送'))
    await sendBtn?.trigger('click')
    await flushPromises()

    expect(fileApi.uploadFile).toHaveBeenCalledTimes(1)
    expect(conversationsApi.sendMessage).toHaveBeenCalledTimes(1)
    // 失败后草稿还在，用户可以直接重试
    expect((textarea.element as HTMLTextAreaElement).value).toBe('带附件的消息')

    // 第二次发送（重试）：**不再上传**
    await sendBtn?.trigger('click')
    await flushPromises()

    expect(fileApi.uploadFile).toHaveBeenCalledTimes(1)
    expect(conversationsApi.sendMessage).toHaveBeenCalledTimes(2)
    // 重试时用的是第一次上传出来的 fileId
    expect(conversationsApi.sendMessage).toHaveBeenLastCalledWith(
      '10',
      '带附件的消息',
      '500'
    )
  })

  /**
   * 评审的用例缺口：选附件 → 上传 → 带 fileId 发消息这条链路没有组件用例。
   *
   * 这里钉住完整链路：选文件后上传一次，发消息时带上上传拿到的 fileId，
   * 且发成功后才清掉 pendingFile / uploadedFileId。
   */
  it('选附件 → 上传 → 带 fileId 发消息（完整链路）', async () => {
    const wrapper = await mountView()
    await openFirstConversation(wrapper)

    const upload = wrapper.findComponent({ name: 'ElUpload' })
    const onChange = (upload.props() as Record<string, unknown>)['onChange'] as
      | ((f: unknown) => void)
      | undefined
    onChange?.({ raw: new File(['内容'], '会议纪要.txt') })
    await flushPromises()

    const textarea = wrapper.find('.msg-input textarea')
    await textarea.setValue('纪要在这里')
    const sendBtn = wrapper.findAll('.msg-input button').find((b) => b.text().includes('发送'))
    await sendBtn?.trigger('click')
    await flushPromises()

    // 上传一次，且用的是选中的那个文件
    expect(fileApi.uploadFile).toHaveBeenCalledTimes(1)
    const uploaded = fileApi.uploadFile.mock.calls[0][0] as File
    expect(uploaded.name).toBe('会议纪要.txt')

    // 发消息时带上了上传拿到的 fileId
    expect(conversationsApi.sendMessage).toHaveBeenCalledWith('10', '纪要在这里', '500')

    // 发成功后附件清掉（不会重复上传）
    expect(wrapper.find('.msg-pending-file').exists()).toBe(false)
    await sendBtn?.trigger('click')
    await flushPromises()
    expect(fileApi.uploadFile).toHaveBeenCalledTimes(1)
  })
})
