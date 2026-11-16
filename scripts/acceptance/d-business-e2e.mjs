/** 本地 API 验收。每次创建独立账号和课题组，须对一次性本地数据库执行。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:18080')
assert(['127.0.0.1', 'localhost'].includes(base.hostname), '验收脚本只允许本机 API')
assert(process.env.D_ACCEPTANCE_DISPOSABLE === '1', '请确认服务连接一次性本地数据库')
const suffix = randomUUID().slice(0, 8)
const password = 'LocalAcceptance1234!'
let checks = 0

async function api(path, { method = 'GET', token, body, status } = {}) {
  const multipart = body instanceof FormData
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body && !multipart) headers.set('Content-Type', 'application/json')
  const res = await fetch(new URL('/api/v1' + path, base), {
    method,
    headers,
    body: multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const result = await res.json()
  if (status) {
    assert.equal(res.status, status, `${method} ${path}`)
    assert.equal(result.code, status, `${method} ${path} 业务状态码`)
  } else {
    assert(res.ok && result.code === 0, `${method} ${path} · ${res.status} · ${result.message}`)
  }
  checks++
  return result.data
}

const post = (path, body, token) => api(path, { method: 'POST', token, body })
const put = (path, body, token) => api(path, { method: 'PUT', token, body })
const get = (path, token) => api(path, { token })
const register = (name) =>
  post('/auth/register', { username: `d_${name}_${suffix}`, password, nickname: name })

const owner = await register('owner')
const peer = await register('peer')
const outsider = await register('outsider')
const username = `d_owner_${suffix}`
await api('/auth/register', {
  method: 'POST',
  status: 409,
  body: { username, password, nickname: 'duplicate' }
})
await api('/auth/login', {
  method: 'POST',
  status: 401,
  body: { username, password: 'Wrong1234!' }
})
await api('/auth/me', { status: 401 })

const team = await post('/teams', { name: `D本地验收_${suffix}` }, owner.token)
await post('/teams/join', { inviteCode: team.inviteCode }, peer.token)
await api('/teams/join', {
  method: 'POST',
  status: 409,
  token: peer.token,
  body: { inviteCode: team.inviteCode }
})
await api(`/teams/${team.id}/members/${owner.user.id}/role`, {
  method: 'PUT',
  status: 403,
  token: peer.token,
  body: { role: 'admin' }
})
await api('/auth/profile', { method: 'PUT', token: owner.token, body: {}, status: 400 })
await put('/auth/profile', { nickname: '测试组长' }, owner.token)
await api('/auth/password', {
  method: 'PUT',
  token: owner.token,
  status: 400,
  body: { oldPassword: password, newPassword: 'weak' }
})
const newPassword = 'LocalAcceptance5678!'
const changed = await put('/auth/password', { oldPassword: password, newPassword }, owner.token)
await api('/auth/login', { method: 'POST', status: 401, body: { username, password } })
const { token } = await post('/auth/login', { username, password: newPassword })
assert.equal((await get('/auth/me', changed.token)).id, owner.user.id)
assert.equal((await get('/auth/me', token)).nickname, '测试组长')
const query = `?teamId=${team.id}`
const summary = () => get('/stats/contribution' + query, token)
const details = (filter = '') =>
  get('/stats/contribution/details' + query + '&size=100' + filter, token)
assert.equal((await summary()).hasData, false)
assert.equal((await details()).total, 0)
await api('/stats/contribution' + query, { token: outsider.token, status: 403 })
await api('/stats/contribution/details' + query, { token: outsider.token, status: 403 })
console.log('A 线通过：注册、登录、成员权限、个人资料和密码，统计零埋点')

const upload = (name) => {
  const form = new FormData()
  form.append('file', new Blob(['本地验收附件'], { type: 'text/plain' }), name)
  return form
}
await api('/files/upload', { method: 'POST', body: upload('blocked.exe'), token, status: 400 })
const file = await post('/files/upload', upload('验收附件.txt'), token)
assert.match(file.url, /\/[\da-f-]{36}\.txt$/i)
const fileResponse = await fetch(new URL(file.url, base), { signal: AbortSignal.timeout(15000) })
assert(fileResponse.ok)
assert.equal(await fileResponse.text(), '本地验收附件')
assert.equal((await details()).total, 0)

const project = await post('/projects', { teamId: team.id, name: 'D联调项目' }, token)
const task = await post('/tasks', { projectId: project.id, title: 'D联调任务' }, token)
const milestone = await post('/milestones', { projectId: project.id, name: 'D联调里程碑' }, token)
await Promise.all(
  [token, peer.token].map((actor) => put(`/tasks/${task.id}/status`, { status: 'done' }, actor))
)
assert.equal(
  (await details('&dimension=task')).list.filter(
    (event) => event.type === 'task_done' && event.counted
  ).length,
  1,
  '并发完成同一任务只应产生一条有效完成记录'
)
await Promise.all(
  [token, peer.token].map((actor) => put(`/milestones/${milestone.id}`, { status: 'done' }, actor))
)
assert.equal(
  (await details('&dimension=milestone')).list.filter((event) => event.counted).length,
  1,
  '并发完成同一里程碑只应产生一条有效记录'
)
const completedMilestone = await post(
  '/milestones',
  {
    projectId: project.id,
    name: '创建即完成的里程碑',
    status: 'done'
  },
  token
)
assert(
  (await details('&dimension=milestone')).list.some(
    (event) => event.refId === completedMilestone.id && event.counted
  )
)
await api(`/milestones/${completedMilestone.id}`, { method: 'DELETE', token: peer.token })
assert(
  (await details('&dimension=milestone')).list.some(
    (event) => event.refId === completedMilestone.id && event.reason === 'revoked'
  )
)
const comment = await post(
  `/tasks/${task.id}/comments`,
  { content: '仅用于本地联调的任务评论' },
  peer.token
)
const literature = await post(
  '/literatures',
  { teamId: team.id, projectId: project.id, title: 'D联调文献', fileId: file.id },
  token
)
const setRead = (readStatus) =>
  put(`/literatures/${literature.id}/read-status`, { readStatus }, token)
await setRead('read')
await setRead('unread')
await setRead('read')
const meeting = await post(
  '/meetings',
  { projectId: project.id, title: 'D联调会议', attendeeIds: [peer.user.id] },
  token
)
await put(`/meetings/${meeting.id}`, { attendeeIds: [] }, token)
await put(`/meetings/${meeting.id}`, { attendeeIds: [peer.user.id] }, token)
const achievement = await post(
  '/achievements',
  {
    projectId: project.id,
    type: 'software',
    title: 'D联调成果',
    fileId: file.id,
    members: [{ userId: peer.user.id, contributionNote: '该说明仅展示' }]
  },
  token
)
await api(`/achievements/${achievement.id}`, { token: outsider.token, status: 403 })
const beforeChat = await details()
const group = await post('/conversations/group', { projectId: project.id }, token)
assert.equal(
  (await post('/conversations/group', { projectId: project.id }, peer.token)).id,
  group.id
)
const privateChat = await post('/conversations/private', { peerUserId: peer.user.id }, token)
for (const conversation of [group, privateChat]) {
  const body = '普通会话消息不计入参与度'
  await post(`/conversations/${conversation.id}/messages`, { content: body }, token)
  const messages = await get(`/conversations/${conversation.id}/messages`, peer.token)
  assert(messages.some((message) => message.content === body))
  await api(`/conversations/${conversation.id}/messages`, { token: outsider.token, status: 404 })
  assert(
    (await get('/conversations/unread', peer.token)).some(
      (item) => item.conversationId === conversation.id && item.unreadCount > 0
    )
  )
  await post(`/conversations/${conversation.id}/read`, undefined, peer.token)
  assert(
    !(await get('/conversations/unread', peer.token)).some(
      (item) => item.conversationId === conversation.id && item.unreadCount > 0
    )
  )
}
const afterChat = await details()
assert.deepEqual(afterChat, beforeChat, '建群、私信、发消息和标为已读均不应新增流水')
console.log('C 线通过：附件、文献撤销、参会撤销、成果归属、群聊私信零埋点和越权隔离')

const valid = afterChat.list.filter((event) => event.counted)
assert.deepEqual(
  valid.map((event) => event.type).sort(),
  [
    'achievement_submit',
    'comment_create',
    'literature_read',
    'literature_upload',
    'meeting_attend',
    'meeting_create',
    'milestone_done',
    'task_create',
    'task_done'
  ].sort()
)
assert.equal(valid.find((event) => event.type === 'achievement_submit').userId, owner.user.id)
assert.equal(valid.find((event) => event.type === 'achievement_submit').source.id, achievement.id)
assert.equal(
  valid.find((event) => event.refType === 'message' && event.refId === comment.id).source.id,
  task.id
)
for (const type of ['literature_read', 'meeting_attend'])
  assert(afterChat.list.some((event) => event.type === type && event.reason === 'revoked'))
const aggregate = await summary()
assert.equal(aggregate.sampleSize, valid.length)
assert.equal(aggregate.memberCount, 2)
assert.equal(aggregate.insufficientSample, true)
assert.equal(
  aggregate.weekly.reduce((sum, week) => sum + week.count, 0),
  valid.length
)
for (const week of aggregate.weekly)
  assert.equal(
    (await details('&weekStart=' + week.weekStart)).list.filter((event) => event.counted).length,
    week.count
  )
await api(`/achievements/${achievement.id}`, { method: 'DELETE', token })
const history = (await details('&dimension=achievement')).list
assert.equal(history.length, 1)
assert.equal(history[0].counted, true)
assert.equal(history[0].source, null)
console.log(
  `D 线通过：9 类事件、6 个维度、周聚合、明细对账和已删除来源回退（${checks} 个 API 响应已检查）`
)
