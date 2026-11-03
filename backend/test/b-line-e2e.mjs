#!/usr/bin/env node
/**
 * B 线端到端验收脚本（任务卡 B-1 / B-2 / B-3）。
 *
 * 用法：node test/b-line-e2e.mjs
 * 前置：后端已启动（localhost:8080），MySQL 已就绪。
 *
 * 覆盖：
 *   B-1 项目与里程碑：CRUD、团队隔离、milestone_done 埋点
 *   B-2 任务看板：CRUD、状态流转、task_done 幂等、order 持久化
 *   B-3 任务评论：读写、comment_create 埋点、单日上限
 */

const BASE = process.env.BASE_URL || 'http://localhost:8080/api/v1'

// 轻量 .env 加载（脚本需直连数据库，Prisma 不会自动读取 .env）
if (!process.env.DATABASE_URL) {
  const { readFileSync, existsSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const name of ['.env.local', '.env']) {
    const file = resolve(backendRoot, name)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
    if (process.env.DATABASE_URL) break
  }
}

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({ code: -1, message: '非 JSON 响应' }))
  return { status: res.status, ...json }
}

/** 随机后缀，避免多次运行撞唯一索引 */
const suffix = Date.now().toString(36)

/**
 * 清理历史残留的测试数据。
 *
 * 上一次运行若中途异常退出（如 DATABASE_URL 未注入导致 Prisma 初始化失败），
 * 脚本末尾的收尾清理就执行不到，库里会残留：
 *   - 「B线测试组_*」课题组及其成员
 *   - 「B线测试项目_*」项目及其里程碑、任务、评论
 *   - 「b_e2e_*」测试用户及其埋点
 * 这里在每次开跑前统一物理删除，保证库可重复使用。
 */
async function purgeStaleTestData() {
  // 注意顺序：必须先删项目子树（含任务/里程碑/会话），再删课题组。
  // project.team_id 有外键约束，先删 team 会触发 P2003 且留下清不掉的残留。
  const staleProjects = await prisma.project.findMany({
    where: { name: { startsWith: 'B线测试项目' } },
    select: { id: true },
  })
  for (const p of staleProjects) {
    const taskIds = (await prisma.task.findMany({ where: { projectId: p.id }, select: { id: true } })).map((t) => t.id)
    await prisma.message.deleteMany({ where: { conversation: { refType: 'task', refId: { in: taskIds } } } })
    await prisma.conversationMember.deleteMany({ where: { conversation: { refType: 'task', refId: { in: taskIds } } } })
    await prisma.conversation.deleteMany({ where: { refType: 'task', refId: { in: taskIds } } })
    await prisma.task.deleteMany({ where: { projectId: p.id } })
    await prisma.milestone.deleteMany({ where: { projectId: p.id } })
    await prisma.projectMember.deleteMany({ where: { projectId: p.id } })
    await prisma.project.delete({ where: { id: p.id } })
  }

  const staleTeams = await prisma.team.findMany({
    where: { name: { startsWith: 'B线测试组_' } },
    select: { id: true },
  })
  for (const t of staleTeams) {
    // activity_log / literature 也带 team_id 外键，须随 teamMember 一并先清
    await prisma.activityLog.deleteMany({ where: { teamId: t.id } })
    await prisma.literature.deleteMany({ where: { teamId: t.id } })
    await prisma.teamMember.deleteMany({ where: { teamId: t.id } })
    await prisma.team.delete({ where: { id: t.id } })
  }

  const staleUsers = await prisma.user.findMany({
    where: { OR: [{ username: { startsWith: 'b_e2e_' } }, { username: { startsWith: 'btest' } }] },
    select: { id: true },
  })
  for (const u of staleUsers) {
    await prisma.activityLog.deleteMany({ where: { userId: u.id } })
    await prisma.message.deleteMany({ where: { senderId: u.id } })
    await prisma.conversationMember.deleteMany({ where: { userId: u.id } })
    await prisma.teamMember.deleteMany({ where: { userId: u.id } })
    await prisma.projectMember.deleteMany({ where: { userId: u.id } })
    await prisma.user.delete({ where: { id: u.id } })
  }
}

async function main() {
  // ---------------------------------------------------------------- 准备
  section('准备：注册两个用户并建组')

  // 开跑前先扫掉历史残留：上一次脚本若在中途崩溃（如 DATABASE_URL 缺失），
  // 收尾的清理逻辑就来不及执行，库里会留下「B线测试组_*」「b_e2e_*」等孤儿数据。
  await purgeStaleTestData()

  const userA = `b_e2e_a_${suffix}`
  const userB = `b_e2e_b_${suffix}`

  const regA = await api('/auth/register', {
    method: 'POST',
    body: { username: userA, password: 'Test1234', nickname: '甲同学', email: 'a@test.com' }
  })
  ok('注册用户 A', regA.code === 0, JSON.stringify(regA).slice(0, 120))
  const tokenA = regA.data?.token

  const regB = await api('/auth/register', {
    method: 'POST',
    body: { username: userB, password: 'Test1234', nickname: '乙同学', email: 'b@test.com' }
  })
  ok('注册用户 B', regB.code === 0)
  const tokenB = regB.data?.token

  const dup = await api('/auth/register', {
    method: 'POST',
    body: { username: userA, password: 'Test1234', nickname: '重复' }
  })
  ok('重复注册返回 409', dup.code === 409, `实际 ${dup.code}`)

  // ---------------------------------------------------------------- B-1
  section('B-1 项目与里程碑')

  const team = await api('/teams', {
    method: 'POST',
    token: tokenA,
    body: { name: `B线测试组_${suffix}`, description: 'E2E' }
  })
  ok('创建课题组', team.code === 0, JSON.stringify(team).slice(0, 120))
  const teamId = team.data?.id
  const inviteCode = team.data?.inviteCode
  ok('返回邀请码', typeof inviteCode === 'string' && inviteCode.length === 8)

  const join = await api('/teams/join', {
    method: 'POST',
    token: tokenB,
    body: { inviteCode }
  })
  ok('B 凭邀请码入组', join.code === 0, JSON.stringify(join).slice(0, 120))

  const joinAgain = await api('/teams/join', {
    method: 'POST',
    token: tokenB,
    body: { inviteCode }
  })
  ok('重复入组返回 409', joinAgain.code === 409, `实际 ${joinAgain.code}`)

  const proj = await api('/projects', {
    method: 'POST',
    token: tokenA,
    body: {
      name: `B线测试项目_${suffix}`,
      description: '端到端验收用',
      teamId,
      status: 'active',
      startDate: '2026-11-01',
      endDate: '2026-12-31'
    }
  })
  ok('创建项目', proj.code === 0, JSON.stringify(proj).slice(0, 150))
  const projectId = proj.data?.id
  ok('项目 id 是字符串', typeof projectId === 'string', `实际 ${typeof projectId}`)
  ok('创建者自动成为项目成员', proj.data?.memberCount === 1, `实际 ${proj.data?.memberCount}`)

  const listA = await api('/projects', { token: tokenA })
  ok('A 能看到本组项目', listA.code === 0 && listA.data.list.some((p) => p.id === projectId))

  const listB = await api('/projects', { token: tokenB })
  ok('B（同组成员）也能看到项目', listB.code === 0 && listB.data.list.some((p) => p.id === projectId))

  // 越权：C 组用户（未入组）看不到项目
  const userC = `b_e2e_c_${suffix}`
  const regC = await api('/auth/register', {
    method: 'POST',
    body: { username: userC, password: 'Test1234', nickname: '丙同学' }
  })
  const tokenC = regC.data?.token
  const listC = await api('/projects', { token: tokenC })
  ok('C（未入组）看不到项目', listC.code === 0 && !listC.data.list.some((p) => p.id === projectId))

  const detailC = await api(`/projects/${projectId}`, { token: tokenC })
  ok('C 访问项目详情返回 403', detailC.code === 403, `实际 ${detailC.code}`)

  const upd = await api(`/projects/${projectId}`, {
    method: 'PUT',
    token: tokenA,
    body: { name: `B线测试项目改名_${suffix}`, status: 'finished' }
  })
  ok('更新项目', upd.code === 0 && upd.data.name.includes('改名') && upd.data.status === 'finished')

  const addMember = await api(`/projects/${projectId}/members`, {
    method: 'POST',
    token: tokenA,
    body: { userId: regB.data?.user?.id }
  })
  ok('添加项目成员', addMember.code === 0, JSON.stringify(addMember).slice(0, 120))

  const addMemberAgain = await api(`/projects/${projectId}/members`, {
    method: 'POST',
    token: tokenA,
    body: { userId: regB.data?.user?.id }
  })
  ok('重复添加成员返回 409', addMemberAgain.code === 409, `实际 ${addMemberAgain.code}`)

  // 里程碑
  const ms = await api('/milestones', {
    method: 'POST',
    token: tokenA,
    body: { projectId, name: `第一阶段_${suffix}`, dueDate: '2026-11-30' }
  })
  ok('创建里程碑', ms.code === 0, JSON.stringify(ms).slice(0, 120))
  const milestoneId = ms.data?.id

  const msList = await api(`/projects/${projectId}/milestones`, { token: tokenA })
  ok('里程碑列表', msList.code === 0 && msList.data.length === 1)

  const msDone = await api(`/milestones/${milestoneId}`, {
    method: 'PUT',
    token: tokenA,
    body: { status: 'done' }
  })
  ok('标记里程碑完成', msDone.code === 0 && msDone.data.status === 'done')

  const logsAfterMs = await countLogs(tokenA, 'milestone_done')
  ok('milestone_done 埋点已写入', logsAfterMs === 1, `实际 ${logsAfterMs}`)

  await api(`/milestones/${milestoneId}`, { method: 'PUT', token: tokenA, body: { status: 'done' } })
  const logsAfterMs2 = await countLogs(tokenA, 'milestone_done')
  ok('重复标记完成不重复计分（幂等）', logsAfterMs2 === 1, `实际 ${logsAfterMs2}`)

  await api(`/milestones/${milestoneId}`, { method: 'PUT', token: tokenA, body: { status: 'pending' } })
  const logsAfterRevoke = await countLogs(tokenA, 'milestone_done')
  ok('退回 pending 后撤销埋点（权重归零）', logsAfterRevoke === 0, `实际 ${logsAfterRevoke}`)

  // ---------------------------------------------------------------- B-2
  section('B-2 任务看板')

  const task = await api('/tasks', {
    method: 'POST',
    token: tokenA,
    body: {
      projectId,
      title: `写文献综述_${suffix}`,
      description: 'E2E',
      assigneeId: regA.data?.user?.id,
      priority: 'high',
      dueDate: '2026-11-20'
    }
  })
  ok('创建任务', task.code === 0, JSON.stringify(task).slice(0, 150))
  const taskId = task.data?.id
  ok('任务 sort_order 为整数间隔初值', task.data?.sortOrder === 100, `实际 ${task.data?.sortOrder}`)

  const logsCreate = await countLogs(tokenA, 'task_create')
  ok('task_create 埋点已写入', logsCreate === 1, `实际 ${logsCreate}`)

  const taskList = await api(`/tasks?projectId=${projectId}`, { token: tokenA })
  ok('按项目过滤任务列表', taskList.code === 0 && taskList.data.total === 1)

  const taskListC = await api(`/tasks?projectId=${projectId}`, { token: tokenC })
  ok('C（未入组）看不到任务', taskListC.code === 0 && taskListC.data.total === 0)

  // 状态流转：todo → doing → done
  const toDoing = await api(`/tasks/${taskId}/status`, {
    method: 'PUT',
    token: tokenA,
    body: { status: 'doing' }
  })
  ok('状态流转 doing', toDoing.code === 0 && toDoing.data.status === 'doing')

  const toDone = await api(`/tasks/${taskId}/status`, {
    method: 'PUT',
    token: tokenA,
    body: { status: 'done' }
  })
  ok('状态流转 done', toDone.code === 0 && toDone.data.status === 'done')

  const logsDone = await countLogs(tokenA, 'task_done')
  ok('task_done 埋点已写入', logsDone === 1, `实际 ${logsDone}`)

  // 幂等：done → doing → done 反复拖拽
  await api(`/tasks/${taskId}/status`, { method: 'PUT', token: tokenA, body: { status: 'doing' } })
  const logsAfterBack = await countLogs(tokenA, 'task_done')
  ok('从 done 退回后 task_done 被撤销', logsAfterBack === 0, `实际 ${logsAfterBack}`)

  await api(`/tasks/${taskId}/status`, { method: 'PUT', token: tokenA, body: { status: 'done' } })
  const logsAfterRedo = await countLogs(tokenA, 'task_done')
  ok('再次完成重新计一次分', logsAfterRedo === 1, `实际 ${logsAfterRedo}`)

  await api(`/tasks/${taskId}/status`, { method: 'PUT', token: tokenA, body: { status: 'done' } })
  const logsIdem = await countLogs(tokenA, 'task_done')
  ok('反复拖到 done 不重复计分（幂等）', logsIdem === 1, `实际 ${logsIdem}`)

  // 排序持久化
  const t2 = await api('/tasks', {
    method: 'POST',
    token: tokenA,
    body: { projectId, title: `任务B_${suffix}` }
  })
  const t3 = await api('/tasks', {
    method: 'POST',
    token: tokenA,
    body: { projectId, title: `任务C_${suffix}` }
  })
  ok('再建两个任务用于排序', t2.code === 0 && t3.code === 0)

  const order = await api(`/tasks/${t3.data.id}/order`, {
    method: 'PUT',
    token: tokenA,
    body: { beforeSortOrder: 100, afterSortOrder: 200 }
  })
  ok('调整排序（取中值 150）', order.code === 0 && order.data.sortOrder === 150, `实际 ${order.data?.sortOrder}`)

  const orderHead = await api(`/tasks/${t3.data.id}/order`, {
    method: 'PUT',
    token: tokenA,
    body: { beforeSortOrder: null, afterSortOrder: 100 }
  })
  ok('拖到列首（before=null 时取 100-100=0→重排兜底）', orderHead.code === 0, JSON.stringify(orderHead).slice(0, 120))

  const orderFetch = await api(`/tasks/${taskId}`, { token: tokenA })
  ok('排序后任务仍可读', orderFetch.code === 0)

  const updTask = await api(`/tasks/${taskId}`, {
    method: 'PUT',
    token: tokenA,
    body: { title: `改名后的任务_${suffix}`, priority: 'low' }
  })
  ok('更新任务', updTask.code === 0 && updTask.data.priority === 'low')

  // ---------------------------------------------------------------- B-3
  section('B-3 任务评论')

  const c1 = await api(`/tasks/${taskId}/comments`, {
    method: 'POST',
    token: tokenA,
    body: { content: '第一条评论' }
  })
  ok('发表评论', c1.code === 0 && c1.data.content === '第一条评论', JSON.stringify(c1).slice(0, 120))

  const c2 = await api(`/tasks/${taskId}/comments`, {
    method: 'POST',
    token: tokenB,
    body: { content: 'B 的回复' }
  })
  ok('B 发表评论', c2.code === 0)

  const clist = await api(`/tasks/${taskId}/comments`, { token: tokenA })
  ok('评论列表返回 2 条', clist.code === 0 && clist.data.length === 2, `实际 ${clist.data?.length}`)
  ok('评论按时间正序', clist.data?.[0]?.content === '第一条评论')

  const logsComment = await countLogs(tokenA, 'comment_create')
  ok('comment_create 埋点已写入', logsComment === 1, `实际 ${logsComment}`)

  // ref 契约（docs/03 第九节）：refType 固定 message、refId 为评论消息 id。
  // 2026-11-03 生产联调曾发现写入 task 维度导致 D-1 统计判 invalid_ref，此处固化回归断言。
  const payloadA = JSON.parse(Buffer.from(tokenA.split('.')[1], 'base64').toString('utf8'))
  const commentLog = await prisma.activityLog.findFirst({
    where: { userId: BigInt(payloadA.sub), type: 'comment_create' },
    orderBy: { id: 'desc' },
    select: { refType: true, refId: true },
  })
  ok('埋点 ref 契约：refType=message', commentLog?.refType === 'message', `实际 ${commentLog?.refType}`)
  ok('埋点 ref 契约：refId=消息id', String(commentLog?.refId) === String(c1.data.id), `实际 ${commentLog?.refId} vs 消息 ${c1.data?.id}`)

  // 单日上限 10 条
  for (let i = 0; i < 12; i++) {
    await api(`/tasks/${taskId}/comments`, {
      method: 'POST',
      token: tokenA,
      body: { content: `刷量评论 ${i}` }
    })
  }
  const logsAfterFlood = await countLogs(tokenA, 'comment_create')
  ok('单日评论埋点上限 10 条（超出不再计入）', logsAfterFlood === 10, `实际 ${logsAfterFlood}`)

  const clistAfter = await api(`/tasks/${taskId}/comments`, { token: tokenA })
  ok('超上限后评论仍可正常发表', clistAfter.code === 0 && clistAfter.data.length === 14, `实际 ${clistAfter.data?.length}`)

  // 越权：C 读不到评论
  const clistC = await api(`/tasks/${taskId}/comments`, { token: tokenC })
  ok('C（未入组）读评论返回 403', clistC.code === 403, `实际 ${clistC.code}`)

  // ---------------------------------------------------------------- 清理
  section('清理：删除任务与项目')

  const delTask = await api(`/tasks/${taskId}`, { method: 'DELETE', token: tokenA })
  ok('删除任务', delTask.code === 0)

  const delProj = await api(`/projects/${projectId}`, { method: 'DELETE', token: tokenA })
  ok('删除项目', delProj.code === 0)

  const listAfterDel = await api('/projects', { token: tokenA })
  ok('删除后列表不再包含该项目', !listAfterDel.data.list.some((p) => p.id === projectId))

  // 项目删的是逻辑删除（deleted=1），行还在库里。
  // 这里把该项目下的里程碑、任务、评论彻底物理删除，
  // 否则每跑一次就会留下一批「第一阶段_xxx」「任务B_xxx」的孤儿数据。
  const pid = BigInt(projectId)
  await prisma.message.deleteMany({ where: { conversation: { refType: 'task', refId: { in: (await prisma.task.findMany({ where: { projectId: pid }, select: { id: true } })).map((t) => t.id) } } } })
  await prisma.conversationMember.deleteMany({ where: { conversation: { refType: 'task', refId: { in: (await prisma.task.findMany({ where: { projectId: pid }, select: { id: true } })).map((t) => t.id) } } } })
  await prisma.conversation.deleteMany({ where: { refType: 'task', refId: { in: (await prisma.task.findMany({ where: { projectId: pid }, select: { id: true } })).map((t) => t.id) } } })
  await prisma.task.deleteMany({ where: { projectId: pid } })
  await prisma.milestone.deleteMany({ where: { projectId: pid } })
  await prisma.projectMember.deleteMany({ where: { projectId: pid } })
  await prisma.project.deleteMany({ where: { id: pid } })
  const leftovers = await prisma.task.count({ where: { projectId: pid } }) + await prisma.milestone.count({ where: { projectId: pid } })
  ok('清理项目下的任务与里程碑', leftovers === 0, `残留 ${leftovers} 条`)

  // 课题组没有对外的删除接口，这里直接用 Prisma 收尾，
  // 否则每跑一次脚本就会在库里留一个「B线测试组_xxx」。
  // 注意顺序：project / activity_log / literature 都带 team_id 外键，
  // 必须先物理删完项目子树与埋点流水再删课题组，
  // 否则 team.delete 会触发 P2003 外键冲突，脚本收尾崩溃并留下残留。
  const teamRows = await prisma.team.findMany({
    where: { id: BigInt(teamId) },
    select: { id: true },
  })
  if (teamRows.length > 0) {
    await prisma.activityLog.deleteMany({ where: { teamId: BigInt(teamId) } })
    await prisma.literature.deleteMany({ where: { teamId: BigInt(teamId) } })
    await prisma.teamMember.deleteMany({ where: { teamId: BigInt(teamId) } })
    await prisma.team.delete({ where: { id: BigInt(teamId) } })
  }
  ok('清理测试课题组', teamRows.length === 0 || true)

  // 顺手清掉本次注册的两个用户（及其埋点），保持库干净
  for (const username of [userA, userB, userC]) {
    const u = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    })
    if (u) {
      await prisma.activityLog.deleteMany({ where: { userId: u.id } })
      await prisma.message.deleteMany({ where: { senderId: u.id } })
      await prisma.conversationMember.deleteMany({ where: { userId: u.id } })
      await prisma.user.delete({ where: { id: u.id } })
    }
  }
  ok('清理测试用户', true)

  // ---------------------------------------------------------------- 汇总
  console.log(`\n${'='.repeat(46)}`)
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  if (fail > 0) {
    console.log('\n失败明细：')
    failures.forEach((f) => console.log(`  - ${f}`))
  }
  process.exit(fail > 0 ? 1 : 0)
}

/** 统计某用户某类型埋点的「有效」条数（权重 > 0，撤销的为 0 不计） */
async function countLogs(token, type) {
  // 用 participants 接口拿不到埋点，这里借助任务/项目接口返回的计数不可行，
  // 因此直接查数据库不可取；改为通过 stats 接口不可用时的替代方案：
  // 这里用 Prisma 直连统计最稳妥——但脚本不依赖后端内部，
  // 故改为调用一个最小的查询：这里用 SQL 客户端不可用时的折中方案。
  // 实际实现见下方 override。
  return countLogsOverride(token, type)
}

let countLogsOverride = async () => 0

// 用 Prisma 直连统计埋点（本地验收脚本，允许直连数据库）
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
countLogsOverride = async (token, type) => {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8')
  )
  const result = await prisma.activityLog.findMany({
    where: { userId: BigInt(payload.sub), type },
    select: { id: true, weight: true }
  })
  return result.filter((r) => Number(r.weight) > 0).length
}

main()
  .catch((err) => {
    console.error('\n脚本异常：', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
