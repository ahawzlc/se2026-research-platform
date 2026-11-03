import assert from 'node:assert/strict'

// 仅 GET；不创建用户、不造线上埋点。令牌只从环境读取，不输出。
const base = process.env.BASE_URL || 'http://127.0.0.1:8080'
const token = process.env.TOKEN
const teamId = process.env.TEAM_ID
assert(token && teamId, '请设置 TOKEN 与 TEAM_ID（BASE_URL 默认本地 8080）')
async function get(path, status = 200, authenticated = true) {
  const response = await fetch(new URL(`/api/v1/stats/contribution${path}`, base), {
    headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000)
  })
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.code, status === 200 ? 0 : status)
  return body.data
}
await get(`?teamId=${encodeURIComponent(teamId)}`, 401, false)
await get('?teamId=0', 400)
await get(`?teamId=${encodeURIComponent(teamId)}&unexpected=1`, 400)
const summary = await get(`?teamId=${encodeURIComponent(teamId)}`)
assert.equal(summary.teamId, teamId)
assert.equal(summary.dimensions.length, 6)
assert.equal(summary.modelVersion, 'participation-v1-snapshot')
assert(summary.disclaimer.includes('不构成科研贡献评价'))
assert.equal(summary.weekly.reduce((sum, week) => sum + week.count, 0), summary.sampleSize)
if (!summary.hasData) {
  assert.deepEqual(summary.members, [])
  assert.deepEqual(summary.weekly, [])
}
for (const member of summary.members) {
  assert.equal(typeof member.userId, 'string')
  assert(member.index === null || (member.index >= 0 && member.index <= 1))
}
const details = await get(`/details?teamId=${encodeURIComponent(teamId)}&size=100`)
assert.equal(details.page, 1)
assert.equal(details.size, 100)
for (const row of details.list) {
  assert.equal(typeof row.id, 'string')
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(row.counted, row.reason === 'counted')
  if (!row.counted) assert.equal(row.countedWeight, 0)
}
console.log(`D-1 只读验收通过：有效样本 ${summary.sampleSize}，当前成员 ${summary.members.length}`)
