/**
 * 造一批演示数据（供截图与手工验收用）。
 *
 * 用法：node scripts/seed-demo.mjs
 * 会创建：demo_alice / demo_bob / demo_carol / demo_dave，以及若干好友关系与好友申请。
 *
 * 脚本可重复执行：已存在的账号会复用，已存在的申请/关系会跳过。
 */
const BASE = 'http://localhost:8080/api/v1'

async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    // headers 要在 options 之后合并：options.headers 里只带 Authorization，
    // 若让它整体覆盖会丢掉 Content-Type，服务端拿不到 JSON body。
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const body = await res.json()
  if (body.code !== 0) {
    throw new Error(`${path} → ${body.code} ${body.message}`)
  }
  return body.data
}

async function login(username) {
  const out = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'Demo12345!' }),
  })
  return out.token
}

async function ensureUser(username, nickname, bio) {
  try {
    await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password: 'Demo12345!',
        nickname,
      }),
    })
    console.log(`✓ 注册 ${username}`)
  } catch (e) {
    console.log(`· ${username} 已存在`)
  }

  const token = await login(username)
  await call('/users/me', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ bio }),
  })
  const me = await call('/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { token, uid: me.publicUid, nickname }
}

/** 尝试发起好友申请；已存在关系/申请时忽略 */
async function requestFriendship(from, target) {
  try {
    const r = await call('/friends/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${from.token}` },
      body: JSON.stringify({ uid: target.uid }),
    })
    console.log(`✓ 申请 → ${target.nickname}`)
    return r
  } catch (e) {
    console.log(`· 申请 → ${target.nickname}：${e.message}`)
    return null
  }
}

async function acceptFriendship(accepter, requesterUid) {
  try {
    const { incoming } = await call('/friends/requests', {
      headers: { Authorization: `Bearer ${accepter.token}` },
    })
    const hit = incoming.find((r) => r.publicUid === requesterUid)
    if (!hit) {
      console.log(`· ${accepter.nickname} 没有收到 ${requesterUid} 的申请`)
      return false
    }
    await call(`/friends/requests/${hit.requestId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accepter.token}` },
    })
    console.log(`✓ ${accepter.nickname} 接受了 ${hit.nickname} 的申请`)
    return true
  } catch (e) {
    console.log(`· 接受申请：${e.message}`)
    return false
  }
}

async function main() {
  const alice = await ensureUser('demo_alice', '爱丽丝', '研究方向：自然语言处理与人机协作')
  const bob = await ensureUser('demo_bob', '鲍勃', '博士生在读，专注分布式系统')
  const carol = await ensureUser('demo_carol', '卡罗尔', '本科毕设：知识图谱可视化')
  const dave = await ensureUser('demo_dave', '戴夫', '负责平台后端与数据统计')

  // 1) Alice ↔ Bob 成为好友（演示好友列表 + 发私信）
  const bobToAlice = await requestFriendship(bob, alice)
  if (bobToAlice) {
    await acceptFriendship(alice, bob.uid)
  } else {
    // Bob 已经申请过，直接由 Alice 接受
    await acceptFriendship(alice, bob.uid)
  }

  // 2) Carol → Alice 的申请保持 pending（演示「收到的申请」页签 + 通知）
  await requestFriendship(carol, alice)

  // 3) Alice → Dave 的申请保持 pending（演示「发出的申请」页签）
  await requestFriendship(alice, dave)

  // 4) Dave → Bob 的申请保持 pending（演示 Bob 侧的「收到的申请」）
  await requestFriendship(dave, bob)

  console.log('\n演示账号（密码统一 Demo12345!）：')
  console.log(`  demo_alice  UID=${alice.uid}`)
  console.log(`  demo_bob    UID=${bob.uid}`)
  console.log(`  demo_carol  UID=${carol.uid}`)
  console.log(`  demo_dave   UID=${dave.uid}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
