import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const { TEAM_ID, TOKEN, BASE_URL = 'http://127.0.0.1:8080' } = process.env
const [candidateJson, snapshotPath] = process.argv.slice(2)
assert(candidateJson, '传入候选维度权重 JSON')
const candidate = JSON.parse(candidateJson)
assert(
  candidate && typeof candidate === 'object' && !Array.isArray(candidate),
  '候选权重必须为对象'
)

async function loadSnapshot() {
  if (snapshotPath) {
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    return snapshot.data ?? snapshot
  }
  assert(TEAM_ID && TOKEN, '设置 TEAM_ID、TOKEN 或传入已脱敏的本地统计快照文件')
  const url = new URL('/api/v1/stats/contribution', BASE_URL)
  url.searchParams.set('teamId', TEAM_ID)
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(15000)
  })
  assert(response.ok, `统计接口请求失败（HTTP ${response.status}）`)
  const { code, data } = await response.json()
  assert.equal(code, 0, '统计接口业务状态异常')
  return data
}

const data = await loadSnapshot()
assert(data?.hasData, '该快照暂无可用于试算的有效行为')
assert(Number.isInteger(data.sampleSize) && data.sampleSize > 0, '快照样本数不合法')
assert(Array.isArray(data.dimensions) && data.dimensions.length === 6, '快照须含六维权重')
assert(Array.isArray(data.members), '快照缺少成员画像')
for (const { key, weight } of data.dimensions)
  assert(typeof key === 'string' && Number.isFinite(weight) && weight > 0, '快照权重不合法')

const weights = Object.fromEntries(data.dimensions.map(({ key, weight }) => [key, weight]))
for (const [key, value] of Object.entries(candidate)) {
  assert(Object.hasOwn(weights, key), `未知维度：${key}`)
  assert(
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100,
    `维度 ${key} 的权重必须在 (0, 100] 内`
  )
}
const proposed = { ...weights, ...candidate }
const denominator = Object.values(proposed).reduce((sum, weight) => sum + weight, 0)
const members = data.members.filter((member) => member.hasData)
assert(members.length > 0, '快照没有有效成员画像')
assert.equal(Object.keys(weights).length, 6, '快照维度重复')
const comparison = members.map((member) => {
  assert(Number.isFinite(member.index) && member.index >= 0 && member.index <= 1, '快照指数不合法')
  assert(Array.isArray(member.dimensions) && member.dimensions.length === 6, '成员画像须含六维')
  assert(new Set(member.dimensions.map((dim) => dim.key)).size === 6, '成员维度重复')
  for (const { key, normalized } of member.dimensions) {
    assert(
      Object.hasOwn(weights, key) &&
        Number.isFinite(normalized) &&
        normalized >= 0 &&
        normalized <= 1,
      '成员归一化值不合法'
    )
  }
  const after =
    member.dimensions.reduce((sum, dim) => sum + dim.normalized * proposed[dim.key], 0) /
    denominator
  return { before: member.index * 100, after: after * 100 }
})
const round = (value) => Math.round(value * 100) / 100
const mean = (key) =>
  round(comparison.reduce((sum, entry) => sum + entry[key], 0) / comparison.length)

console.log(
  JSON.stringify(
    {
      model: data.modelVersion,
      snapshotFingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      validEvents: data.sampleSize,
      activeMembers: members.length,
      insufficientSample: data.insufficientSample,
      baseline: weights,
      candidate: proposed,
      meanIndexBefore: mean('before'),
      meanIndexAfter: mean('after'),
      maxAbsoluteChange: round(
        Math.max(...comparison.map((entry) => Math.abs(entry.after - entry.before)))
      )
    },
    null,
    2
  )
)
