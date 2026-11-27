/**
 * 线③ 界面截图脚本（CONTRIBUTING 要求「涉及界面改动请附截图」）。
 *
 * 复用 l3-golden-path.mjs 的 CDP 直连方式：Node 内置 WebSocket，不引 puppeteer。
 * 产出到 docs/screenshots/：
 *   l3-meeting-discussion.png       会议详情里的讨论区（可发言）
 *   l3-meeting-discussion-ro.png    已结束会议的讨论区（只读，输入框禁用）
 *   l3-messages-file.png            消息页的附件卡片
 *   l3-messages-readonly.png        消息页对只读会议讨论区的感知
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

const base = new URL(process.env.BASE_URL ?? 'http://127.0.0.1:5174')
const apiBase = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:18080')
const outDir = join(process.cwd(), 'docs', 'screenshots')
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)

const suffix = randomUUID().slice(0, 8)
const password = 'Line3Screenshot1234!'

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body) headers.set('Content-Type', 'application/json')
  const res = await fetch(new URL('/api/v1' + path, apiBase), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  const result = await res.json()
  assert(res.ok && result.code === 0, `${method} ${path} · ${res.status} · ${result.message}`)
  return result.data
}
const post = (path, body, token) => api(path, { method: 'POST', token, body })
const register = (name) =>
  post('/auth/register', { username: `l3s_${name}_${suffix}`, password, nickname: name })

// ---------------------------------------------------------------- CDP 客户端

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method) {
        for (const handler of this.handlers) handler(message)
      }
    })
  }
  on(method, handler) {
    this.handlers.push((message) => {
      if (message.method === method) handler(message.params ?? {})
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
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        `页面执行失败：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`
      )
    }
    return result.result.value
  }
  close() {
    this.ws.close()
  }
}

/** 拼出绝对地址（CDP 的 Page.navigate 不接受相对路径） */
const url = (path) => new URL(path, base).href

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForText(cdp, text, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await cdp.evaluate(
      `document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`
    )
    if (found) return
    await sleep(300)
  }
  throw new Error(`等待超时：页面未出现「${text}」`)
}

async function waitForSelector(cdp, selector, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return
    await sleep(300)
  }
  throw new Error(`等待超时：页面未出现选择器「${selector}」`)
}

/** 截图并落盘 */
async function shot(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(outDir, file), Buffer.from(data, 'base64'))
  console.log(`  ✓ ${file}`)
}

// ---------------------------------------------------------------- 准备数据

console.log('准备截图数据…')
const alice = await register('alice')
const bob = await register('bob')
const team = await post('/teams', { name: `线③截图_${suffix}` }, alice.token)
await post('/teams/join', { inviteCode: team.inviteCode }, bob.token)
const project = await post(
  '/projects',
  { name: `线③截图项目_${suffix}`, teamId: team.id },
  alice.token
)

// 一场未排期的会议（讨论区可发言）
const openMeeting = await post(
  '/meetings',
  { projectId: project.id, title: `产品评审会_${suffix}`, attendeeIds: [bob.user.id] },
  alice.token
)
// 一场已结束的会议（讨论区只读）
const past = new Date(Date.now() - 3 * 60 * 60 * 1000)
const pad = (n) => String(n).padStart(2, '0')
const heldAt = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(
  past.getHours()
)}:${pad(past.getMinutes())}:00`
// 先建一场**未排期**的会议（此刻讨论区还能发言），
// 发了消息之后再把时间改到过去 → 才切到「已结束 → 只读」口径。
const endedMeeting = await post(
  '/meetings',
  { projectId: project.id, title: `周会（已结束）_${suffix}`, attendeeIds: [bob.user.id] },
  alice.token
)

// 讨论区里发几条消息（含一条文件消息，验证附件卡片）
const openConv = await post('/conversations/meeting', { meetingId: openMeeting.id }, alice.token)
await post(
  `/conversations/${openConv.id}/messages`,
  { content: '大家好，本次会议主要过一遍线③ 的收尾内容。' },
  alice.token
)
await post(
  `/conversations/${openConv.id}/messages`,
  { content: '我把会议纪要整理好了，见附件。' },
  alice.token
)
// 上传一个带中文名的文件并以附件消息发出
const form = new FormData()
form.append('file', new Blob([Buffer.from('会议纪要要点：1) 讨论区 2) 附件 3) 只读')]), '会议纪要.txt')
const upRes = await fetch(new URL('/api/v1/files/upload', apiBase), {
  method: 'POST',
  headers: { Authorization: `Bearer ${alice.token}` },
  body: form,
  signal: AbortSignal.timeout(15000)
})
const upJson = await upRes.json()
assert(upJson.code === 0, `上传失败：${JSON.stringify(upJson)}`)
await post(
  `/conversations/${openConv.id}/messages`,
  { content: '纪要文档在这里', fileId: upJson.data.id },
  alice.token
)

const endedConv = await post('/conversations/meeting', { meetingId: endedMeeting.id }, alice.token)
await post(
  `/conversations/${endedConv.id}/messages`,
  { content: '这场会已经结束，讨论区只读。' },
  alice.token
)
// 会议改成过去时间 → 触发「已结束 → 只读」口径
await api(`/meetings/${endedMeeting.id}`, {
  method: 'PUT',
  token: alice.token,
  body: { heldAt }
})
console.log(`  数据就绪：会议 ${openMeeting.id} / ${endedMeeting.id}`)

// ---------------------------------------------------------------- 启动 Chrome

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

async function resolveBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await import('node:fs/promises').then((fs) => fs.access(candidate))
      return candidate
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error(`未找到 Chromium 浏览器，请设 CHROME_PATH。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
}

await mkdir(outDir, { recursive: true })
const browserPath = await resolveBrowser()
const userDataDir = join(process.env.TEMP ?? '.', `l3-shot-${suffix}`)
const chrome = spawn(
  browserPath,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

let cdp
try {
  let ready = false
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && !ready) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      ready = !!(await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(300)
    }
  }
  assert(ready, 'Chrome 调试端口未就绪')

  async function newPage() {
    const created = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
      method: 'PUT'
    })
    const target = await created.json()
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    return client
  }

  cdp = await newPage()
  console.log('Chrome 已连接')

  /**
   * 登录并写入 token 到 localStorage。
   *
   * 必须先导航到同源页面再写 localStorage：about:blank 的文档
   * 没有 origin，写 localStorage 会抛 SecurityError。
   */
  async function login(token) {
    await cdp.send('Page.navigate', { url: url('/login') })
    await sleep(800)
    await cdp.evaluate(`localStorage.setItem('se2026_token', ${JSON.stringify(token)})`)
  }

  // ---- 1. 会议详情里的讨论区（可发言）
  await login(alice.token)
  await cdp.send('Page.navigate', { url: url(`/meetings?meetingId=${openMeeting.id}`) })
  await waitForText(cdp, '讨论区')
  await waitForText(cdp, '产品评审会')
  await sleep(1500)
  await shot(cdp, 'l3-meeting-discussion.png')

  // ---- 2. 已结束会议的讨论区（只读）
  await cdp.send('Page.navigate', { url: url(`/meetings?meetingId=${endedMeeting.id}`) })
  await waitForText(cdp, '讨论区')
  await sleep(1500)
  await shot(cdp, 'l3-meeting-discussion-ro.png')

  // ---- 3. 消息页：附件卡片 + 只读感知
  await cdp.send('Page.navigate', { url: url('/messages') })
  await waitForText(cdp, '会议讨论区')
  await sleep(2000)
  await shot(cdp, 'l3-messages-file.png')

  // 点开已结束的会议讨论区，看只读提示
  const clicked = await cdp.evaluate(`
    (() => {
      const items = [...document.querySelectorAll('.conv-item, .conv-line, li, .el-card')]
      for (const el of items) {
        if (el.innerText && el.innerText.includes('周会（已结束）')) {
          el.click()
          return true
        }
      }
      return false
    })()
  `)
  await sleep(2000)
  if (clicked) {
    await waitForText(cdp, '只读')
    await sleep(800)
  }
  await shot(cdp, 'l3-messages-readonly.png')

  console.log('截图完成。')
} finally {
  cdp?.close()
  chrome.kill()
}
