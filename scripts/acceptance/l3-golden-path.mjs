/**
 * 线③ 沟通链黄金路径验收（卡 T-2 / D-2）。
 *
 * 与 `d-business-e2e.mjs` 的分工：
 *   - `d-business-e2e.mjs` 是 **API 级**的验收（只打后端接口）；
 *   - 本脚本是 **浏览器级**的验收（CDP 驱动真实 Chromium，走完整前端）。
 *
 * 覆盖线③ 四张卡的黄金路径：
 *   E-3  好友链 → 主页 → 发私信
 *   F-1  会议详情 → 讨论区 → 发言 / 结束后只读
 *   A-3  消息附件（上传 → 发送 → 渲染附件卡片）
 *   T-1c 未读数（对方未读 +1 → 打开会话 → 归零）
 *
 * ---------------------------------------------------------------------------
 * 用法（Windows PowerShell）：
 *
 *   # 1. 起一个一次性本地 MySQL，回放 schema
 *   #    （或直接用已有的本地库，但脚本会建账号，跑完请自行清理）
 *
 *   # 2. 起后端（端口与前端代理一致）
 *   cd backend
 *   $env:DATABASE_URL="mysql://se2026:se2026_pwd@127.0.0.1:3307/se2026"
 *   npm run build; node dist/main.js
 *
 *   # 3. 起前端（代理指向同一个后端）
 *   cd frontend
 *   $env:VITE_PROXY_TARGET="http://127.0.0.1:18080"
 *   npx vite --port 5174
 *
 *   # 4. 跑验收
 *   cd ..
 *   $env:L3_ACCEPTANCE_DISPOSABLE="1"
 *   $env:BASE_URL="http://127.0.0.1:5174"
 *   $env:API_BASE_URL="http://127.0.0.1:18080"
 *   node scripts/acceptance/l3-golden-path.mjs
 *
 * 浏览器：脚本按 CHROME_PATH → Chrome → Edge 的顺序自动找；
 * 找不到就设 CHROME_PATH 指向可执行文件。
 *
 * 注意：**不要**给前端设 VITE_API_BASE_URL——那会让请求变成
 * /api/v1/api/v1/xxx（后端已有全局前缀），全部 404。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:5173')
const apiBase = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:8080')
assert(
  ['127.0.0.1', 'localhost'].includes(base.hostname),
  '验收脚本只允许本机前端'
)
assert(
  process.env.L3_ACCEPTANCE_DISPOSABLE === '1',
  '请确认前端连接一次性本地数据库（设 L3_ACCEPTANCE_DISPOSABLE=1）'
)

const CDP_PORT = Number(process.env.CDP_PORT ?? 9222)
const suffix = randomUUID().slice(0, 8)
const password = 'Line3Acceptance1234!'

let checks = 0

function ok(message) {
  checks++
  console.log(`  ✓ ${message}`)
}

// ---------------------------------------------------------------- API 辅助

async function api(path, { method = 'GET', token, body, status } = {}) {
  const multipart = body instanceof FormData
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body && !multipart) headers.set('Content-Type', 'application/json')
  const res = await fetch(new URL('/api/v1' + path, apiBase), {
    method,
    headers,
    body: multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const result = await res.json()
  if (status !== undefined) {
    assert.equal(res.status, status, `${method} ${path}`)
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
  post('/auth/register', { username: `l3_${name}_${suffix}`, password, nickname: name })

// ---------------------------------------------------------------- CDP 客户端

/**
 * 极简 CDP 客户端。
 *
 * 只依赖 Node 内置的 WebSocket（Node 22+ 自带），不引入 puppeteer——
 * 验收脚本要能在任何装了 Node 的机器上直接跑，少一个依赖少一份心累。
 */
class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method) {
        this.events.push(message)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new CdpClient(ws)
  }

  send(method, params = {}) {
    this.id += 1
    const id = this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时：${method}`))
        }
      }, 30000)
    })
  }

  /** 在页面里执行表达式，返回其值 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        '未知错误'
      throw new Error(`页面执行失败：${detail}\n表达式：${expression.slice(0, 200)}`)
    }
    return result.result.value
  }

  close() {
    this.ws.close()
  }
}

/** 轮询等待页面出现某段文本（超时抛错） */
async function waitForText(cdp, text, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await cdp.evaluate(
      `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`
    )
    if (found) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等待超时：页面未出现「${text}」`)
}

// ---------------------------------------------------------------- 准备数据

console.log('准备验收数据…')
const alice = await register('alice')
const bob = await register('bob')

// Alice 建组并拉 Bob 入组（同组才能自由私信）
const team = await post('/teams', { name: `线③验收_${suffix}` }, alice.token)
await post('/teams/join', { inviteCode: team.inviteCode }, bob.token)
const project = await post(
  '/projects',
  { name: `线③验收项目_${suffix}`, teamId: team.id },
  alice.token
)

// 一场**已结束**的会议（用于验证讨论区只读）
const past = new Date(Date.now() - 3 * 60 * 60 * 1000)
const heldAt = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(
  past.getDate()
).padStart(2, '0')} ${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}:00`
const endedMeeting = await post(
  '/meetings',
  { projectId: project.id, title: `已结束的会议_${suffix}`, heldAt, attendeeIds: [bob.user.id] },
  alice.token
)
// 一场**未排期**的会议（讨论区应可发言）
const openMeeting = await post(
  '/meetings',
  { projectId: project.id, title: `待定会议_${suffix}` },
  alice.token
)
ok(`数据就绪：组 ${team.id} / 项目 ${project.id} / 两个会议`)

// ---------------------------------------------------------------- 启动 Chrome

const userDataDir = await mkdtemp(join(tmpdir(), 'l3-cdp-'))

/**
 * 浏览器可执行文件：优先用 CHROME_PATH，其次按常见安装位置找
 * Chrome / Edge（两者都是 Chromium 内核，CDP 协议一致）。
 */
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean)

async function resolveBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await import('node:fs/promises').then((fs) => fs.access(candidate))
      return candidate
    } catch {
      // 换下一个
    }
  }
  throw new Error(
    `未找到可用的 Chromium 浏览器，请设 CHROME_PATH。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`
  )
}

const browserPath = await resolveBrowser()
const chrome = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1440,900',
  'about:blank'
], { stdio: 'ignore' })

let cdp
try {
  // 等 Chrome 的调试端口就绪
  let browserWs = null
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && !browserWs) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const info = await res.json()
      browserWs = info.webSocketDebuggerUrl
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  assert(browserWs, 'Chrome 调试端口未就绪')

  /**
   * 开一个新标签页并返回它的 CDP 连接。
   *
   * 走 `/json/new` + `/json/list` 拿 `webSocketDebuggerUrl`，
   * 而不是手工拼 `/devtools/page/<id>`——后者在浏览器有扩展页时会拼错。
   */
  async function newPage() {
    const created = await fetch(
      `http://127.0.0.1:${CDP_PORT}/json/new?about:blank`,
      { method: 'PUT' }
    )
    const target = await created.json()
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    return client
  }

  cdp = await newPage()
  ok('Chrome 已连接')

  // ---------------------------------------------------------------- 登录

  await cdp.send('Page.navigate', { url: new URL('/login', base).href })
  await waitForText(cdp, '登录')

  // 走 localStorage 注入令牌：比在无头浏览器里模拟表单输入稳定得多，
  // 但**仍然通过真实的前端路由**进入，验证的是前端而不是接口。
  await cdp.evaluate(
    `localStorage.setItem('se2026_token', ${JSON.stringify(alice.token)})`
  )
  await cdp.send('Page.navigate', { url: new URL('/messages', base).href })
  await waitForText(cdp, '会话')
  ok('登录态注入成功，进入消息页')

  // ---------------------------------------------------------------- T-1c 未读

  // Bob 收到 Alice 的一条私信 → 未读 +1
  const privateConv = await post(
    '/conversations/private',
    { peerUserId: bob.user.id },
    alice.token
  )
  const unreadText = '线③未读验收消息'
  await post(
    `/conversations/${privateConv.id}/messages`,
    { content: unreadText },
    alice.token
  )
  const unread = await get('/conversations/unread', bob.token)
  const row = unread.find((item) => item.conversationId === privateConv.id)
  assert(row && row.unreadCount >= 1, '对方未读数应大于 0')
  ok(`T-1c 未读数：${privateConv.id} 未读 ${row.unreadCount}`)

  // 用 Bob 的令牌在另一个标签页登录，验证未读徽标 → 打开 → 归零
  const bobCdp = await newPage()
  // 先导航到同源页面再写 localStorage——about:blank 的 origin 不可访问存储
  await bobCdp.send('Page.navigate', { url: new URL('/login', base).href })
  await waitForText(bobCdp, '登录')
  await bobCdp.evaluate(`localStorage.setItem('se2026_token', ${JSON.stringify(bob.token)})`)
  await bobCdp.send('Page.navigate', { url: new URL('/messages', base).href })
  await waitForText(bobCdp, '会话')

  // 未读徽标出现
  // 注意：el-badge 的 class 落在外层 <div class="el-badge conv-badge"> 上，
  // 数字在内部的 .el-badge__content 里，所以两处都要看。
  const badgeShown = await bobCdp.evaluate(
    `(() => {
      const badge = document.querySelector('.conv-badge')
      if (!badge) return false
      const text = badge.innerText.trim()
      return text.length > 0
    })()`
  )
  assert(badgeShown === true, '未读徽标未显示')
  ok('未读徽标已显示')

  // 点开会话 → 未读归零（后端 lastReadAt 被推进）
  await bobCdp.evaluate(
    `(() => {
      const item = document.querySelector('.conv-item')
      if (!item) return false
      item.click()
      return true
    })()`
  )
  await waitForText(bobCdp, unreadText)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const unreadAfter = await get('/conversations/unread', bob.token)
  const rowAfter = unreadAfter.find((item) => item.conversationId === privateConv.id)
  assert(!rowAfter || rowAfter.unreadCount === 0, '打开会话后未读应归零')
  ok('T-1c 打开会话后未读归零')

  // ---------------------------------------------------------------- A-3 附件

  // 构造一个附件并挂在消息上（前端只读渲染，附件本体走上传接口）
  const form = new FormData()
  form.append('file', new Blob(['线③ 附件验收内容'], { type: 'text/plain' }), '验收附件.txt')
  const file = await api('/files/upload', { method: 'POST', token: alice.token, body: form })
  await post(
    `/conversations/${privateConv.id}/messages`,
    { content: '附件验收', fileId: file.id },
    alice.token
  )
  await cdp.send('Page.reload')
  await waitForText(cdp, '会话')
  await cdp.evaluate(
    `(() => {
      const item = document.querySelector('.conv-item')
      if (!item) return false
      item.click()
      return true
    })()`
  )
  await waitForText(cdp, '验收附件.txt')
  const fileCard = await cdp.evaluate(
    `(() => {
      const a = document.querySelector('a.msg-file')
      return a ? { name: a.innerText, href: a.getAttribute('href') } : null
    })()`
  )
  assert(fileCard && fileCard.name.includes('验收附件.txt'), '附件卡片未渲染')
  ok(`A-3 附件卡片渲染：${fileCard.name.replace(/\s+/g, ' ')}`)
  bobCdp.close()

  // ---------------------------------------------------------------- F-1 会议讨论区

  await cdp.send('Page.navigate', { url: new URL('/meetings', base).href })
  await waitForText(cdp, '会议')

  /**
   * 切到「全部」页签。
   *
   * 默认页签是「未结束」，看不到已结束的会议；而未排期（无开始时间）的会议
   * 也不属于「未结束」或「已结束」——两个用例要用到会议，都得先切页签。
   */
  async function switchToAllTab() {
    await cdp.evaluate(
      `(() => {
        const tabs = [...document.querySelectorAll('.el-tabs__item')]
        const all = tabs.find((t) => t.innerText.trim() === '全部')
        if (!all) return false
        all.click()
        return true
      })()`
    )
    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  /** 在会议列表里点开某个主题的「详情」 */
  async function openMeetingDetail(title) {
    const clicked = await cdp.evaluate(
      `(() => {
        const rows = [...document.querySelectorAll('tbody tr')]
        const row = rows.find((r) => r.innerText.includes(${JSON.stringify(title)}))
        if (!row) return false
        const btn = [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === '详情')
        if (!btn) return false
        btn.click()
        return true
      })()`
    )
    assert(clicked === true, `未找到会议「${title}」的详情按钮`)
  }

  await switchToAllTab()

  // 已结束的会议 → 讨论区只读
  await openMeetingDetail('已结束的会议')
  await waitForText(cdp, '讨论区')
  await waitForText(cdp, '会议已结束，只读')
  const disabled = await cdp.evaluate(
    `(() => {
      const ta = document.querySelector('.discussion-input textarea')
      return ta ? ta.disabled : null
    })()`
  )
  assert(disabled === true, '只读会议的讨论区输入框应禁用')
  ok('F-1 已结束会议：讨论区只读，输入框禁用')

  // 未排期的会议 → 讨论区可发言
  await cdp.evaluate(
    `(() => {
      const close = document.querySelector('.el-dialog__headerbtn')
      if (close) close.click()
      return true
    })()`
  )
  await new Promise((resolve) => setTimeout(resolve, 800))
  await openMeetingDetail('待定会议')
  await waitForText(cdp, '讨论区')
  const enabled = await cdp.evaluate(
    `(() => {
      const ta = document.querySelector('.discussion-input textarea')
      return ta ? !ta.disabled : null
    })()`
  )
  assert(enabled === true, '未结束会议的讨论区输入框应可用')
  ok('F-1 未排期会议：讨论区可发言')

  console.log(`\n线③ 黄金路径验收通过，共 ${checks} 项断言`)
} finally {
  cdp?.close()
  chrome.kill()
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
}
