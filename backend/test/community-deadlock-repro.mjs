#!/usr/bin/env node
/**
 * 「真库集成测试」间歇性 P2034 死锁的复现与对照（PR #46 评审，诊断脚本，不进 CI）。
 *
 * 成环的两方（InnoDB 死锁记录见 docs/18 第九节）：
 *   A. 认证链套件 afterAll 的物理清理  DELETE FROM user WHERE username LIKE 't1a_%'
 *      —— 删父行时逐张检查子表外键，在 notification 等子表的 (user_id, …) 索引末尾留下共享间隙锁；
 *      扫到「用户名排在 t1a_ 之后的第一条用户行」时还要给这一行上排他锁。
 *   B. 社区套件的审批事务 —— 建组 / 入组 / 写通知时的外键检查，持有发帖人与申请人 user 行的共享锁，
 *      接着往 notification 索引末尾插入通知。
 *
 * A 等发帖人的 user 行（被 B 的共享锁挡住），B 等通知索引末尾的插入（被 A 的间隙锁挡住）→ 成环，
 * InnoDB 回滚审批事务，接口返回 500。成环需要「物理删父行」与「插入子表」并发，所以只在两个测试文件
 * 并行时出现；业务代码里没有物理删除用户的路径。
 *
 * 用法（只对一次性数据库执行；脚本会物理删除 t1a_ / t1b_ / t1c_ 前缀的测试数据；
 *       注册接口有按来源限流，两次运行之间请间隔一分钟）：
 *   1. 起一个全新空库（deploy/mysql/init/01-schema.sql）与指向它的后端（localhost:8080）；
 *   2. cd backend && DATABASE_URL='mysql://…' node test/community-deadlock-repro.mjs [--stress]
 *
 * 默认（确定性复现）：用「暂停桩」代替 A 的间隙锁，把 B 卡在插入通知这一步，再让真实的 A 进来，
 *   最后放开暂停桩。用户名的字典序是成环的前提之一，所以命名是刻意的：
 *   t1a_…（被清理的三个用户）< t1b_…（发帖人）< t1c_…（申请人）
 * --stress（对照）：只有审批事务自己并发、没有任何清理，看审批事务之间会不会成环。
 *
 * 退出码：0 符合预期；1 没有复现 / 脚本异常；2 复现了但留下了半截数据，或对照里出现异常。
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/api/v1';
const { PrismaClient } = await import('@prisma/client');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SUFFIX = Date.now().toString(36);
/** 本脚本造数据用的用户名前缀；认证套件的清理语句只认 t1a_ */
const PREFIXES = ['t1a_', 't1b_', 't1c_'];
const NO_WAIT = '（无）';
const STRESS_ROUNDS = 30;

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res
    .json()
    .catch(() => ({ code: -1, message: '非 JSON 响应' }));
  return { status: res.status, ...json };
}

/**
 * 造数据阶段的请求：失败时重试两次。
 * 只用于幂等的准备步骤——本地 Docker 的端口转发会掐断后端连接池里的空闲连接，偶发一次 500；
 * 被观察的请求（审批）不能走这里。
 */
async function setupRequest(path, options) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await api(path, options);
    if (res.code === 0) return res;
    await sleep(300);
  }
  if (/频繁/.test(res.message ?? '')) {
    throw new Error(
      '注册接口被限流了：同一来源一分钟内注册次数有限，请等一分钟再运行。',
    );
  }
  throw new Error(
    `${options?.method ?? 'GET'} ${path} 失败：${JSON.stringify(res)}`,
  );
}

async function register(username) {
  const res = await setupRequest('/auth/register', {
    method: 'POST',
    body: { username, password: 'Passw0rd!2026', nickname: `复现-${username}` },
  });
  return { token: res.data.token, userId: res.data.user.id, username };
}

/** 轮询直到 probe 返回非空；超时则带着当时的锁等待现场失败 */
async function waitFor(label, probe, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await probe();
    if (result) return result;
    await sleep(50);
  }
  throw new Error(
    `等待超时：${label}\n当时的锁等待：\n${await lockWaitText()}`,
  );
}

// 三个连接各走各自的连接池：暂停桩 / 清理 / 观察（审批走后端自己的连接池）
const pause = new PrismaClient();
const cleaner = new PrismaClient();
const monitor = new PrismaClient();

/** 此刻谁在等谁；没有任何锁等待时返回固定标记 */
const lockWaitText = async () => {
  const rows = await monitor.$queryRaw`
    SELECT
      wt.PROCESSLIST_ID AS waitingConn,
      rt.OBJECT_NAME    AS waitingTable,
      rt.INDEX_NAME     AS waitingIndex,
      rt.LOCK_MODE      AS waitingLockMode,
      bt.PROCESSLIST_ID AS blockingConn,
      bl.OBJECT_NAME    AS blockingTable,
      bl.INDEX_NAME     AS blockingIndex,
      bl.LOCK_MODE      AS blockingLockMode
    FROM performance_schema.data_lock_waits w
    JOIN performance_schema.data_locks rt ON rt.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
    JOIN performance_schema.threads wt ON wt.THREAD_ID = w.REQUESTING_THREAD_ID
    JOIN performance_schema.data_locks bl ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
    JOIN performance_schema.threads bt ON bt.THREAD_ID = w.BLOCKING_THREAD_ID
    ORDER BY waitingConn, waitingIndex
  `;
  return rows.length === 0
    ? NO_WAIT
    : rows
        .map(
          (row) =>
            `     连接 ${row.waitingConn} 等 [${row.waitingTable}.${row.waitingIndex} ${row.waitingLockMode}]` +
            ` ← 被连接 ${row.blockingConn} 挡住 [${row.blockingTable}.${row.blockingIndex} ${row.blockingLockMode}]`,
        )
        .join('\n');
};

/** InnoDB 累计检测到的死锁次数（需要先打开对应的计数器） */
const deadlocks = async () => {
  await monitor.$executeRawUnsafe(
    `SET GLOBAL innodb_monitor_enable = 'lock_deadlocks'`,
  );
  const rows = await monitor.$queryRaw`
    SELECT count FROM information_schema.innodb_metrics WHERE name = 'lock_deadlocks'
  `;
  return Number(rows[0].count);
};

/** InnoDB 最近一次检测到的死锁原文（只有一份，新一轮会覆盖） */
const latestDeadlock = async () => {
  const rows = await monitor.$queryRaw`SHOW ENGINE INNODB STATUS`;
  const text = rows
    .map((row) => Object.values(row))
    .flat()
    .find(
      (value) =>
        typeof value === 'string' && value.includes('LATEST DETECTED DEADLOCK'),
    );
  if (!text) return '（InnoDB 状态里没有死锁记录）';
  const start = text.indexOf('LATEST DETECTED DEADLOCK');
  const end = text.indexOf('\n------------\nTRANSACTIONS', start);
  return text.slice(start, end === -1 ? undefined : end).trim();
};

/** 物理删除本脚本前缀下的全部测试数据（仅诊断脚本允许物理删），按外键依赖顺序 */
async function purgeLeftovers() {
  const users = await monitor.user.findMany({
    where: {
      OR: PREFIXES.map((prefix) => ({ username: { startsWith: prefix } })),
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return 0;
  const posts = await monitor.communityPost.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const postIds = posts.map((post) => post.id);
  const teams = await monitor.team.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const teamIds = teams.map((team) => team.id);
  await monitor.notification.deleteMany({ where: { userId: { in: userIds } } });
  await monitor.teamApplication.deleteMany({
    where: { OR: [{ postId: { in: postIds } }, { userId: { in: userIds } }] },
  });
  await monitor.communityPostTag.deleteMany({
    where: { postId: { in: postIds } },
  });
  await monitor.communityPost.deleteMany({ where: { id: { in: postIds } } });
  await monitor.teamMember.deleteMany({
    where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] },
  });
  await monitor.team.deleteMany({ where: { id: { in: teamIds } } });
  await monitor.user.deleteMany({ where: { id: { in: userIds } } });
  return userIds.length;
}

/** 确定性复现：审批事务 × 认证套件的物理清理 */
async function reproduce() {
  console.log('=== 1. 造数据：发帖人 → 三个 t1a_ 用户（将被清理）→ 申请人 ===');
  const author = await register(`t1b_a_${SUFFIX}`);
  const decoys = [];
  for (const name of ['dl', 'n1_dl', 'n2_dl']) {
    decoys.push(await register(`t1a_${name}_${SUFFIX}`));
  }
  const applicant = await register(`t1c_b_${SUFFIX}`);
  console.log(
    `   发帖人 id=${author.userId}，被清理的用户 id=${decoys.map((d) => d.userId).join('/')}，申请人 id=${applicant.userId}`,
  );

  const tags = await setupRequest('/community/tags', { token: author.token });
  const post = await setupRequest('/community/posts', {
    method: 'POST',
    token: author.token,
    body: {
      title: `死锁复现_${SUFFIX}`,
      content: '用于确定性复现 CI 里的死锁',
      tagIds: [tags.data[0].id],
      recruitTotal: 2,
    },
  });
  const application = await setupRequest(
    `/community/posts/${post.data.id}/apply`,
    {
      method: 'POST',
      token: applicant.token,
      body: { note: '我会前端' },
    },
  );
  console.log(`   帖子 #${post.data.id}，申请 #${application.data.id}`);

  console.log(
    '\n=== 2. 暂停桩：在 notification 的 (user_id, is_read) 索引末尾持共享间隙锁（代替清理事务的间隙锁）===',
  );
  let releasePause = () => {};
  const released = new Promise((resolve) => (releasePause = resolve));
  let pauseHeld;
  const held = new Promise((resolve) => (pauseHeld = resolve));
  const pauseTransaction = pause
    .$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM notification WHERE user_id = 999999999 LOCK IN SHARE MODE`;
        pauseHeld();
        await released;
      },
      { maxWait: 10_000, timeout: 120_000 },
    )
    // 脚本中途失败时暂停桩被放开，这个 Promise 的拒绝不该变成未处理异常
    .catch(() => {});
  await held;
  console.log('   暂停桩已持锁');

  // Prisma 交互式事务默认 5 秒超时：从发起审批到放开暂停桩必须压在 5 秒内，
  // 否则审批会以「事务过期」收场，那就不是死锁了。
  console.log(
    '\n=== 3. 发起审批（不等待）：执行到「插入通知」时被暂停桩挡住 ===',
  );
  const approval = api(
    `/community/applications/${application.data.id}/approve`,
    {
      method: 'POST',
      token: author.token,
    },
  ).catch(() => ({ status: 0, code: -1, message: '请求失败' }));
  await waitFor(
    '审批事务进入锁等待',
    async () => (await lockWaitText()) !== NO_WAIT,
  );
  console.log('   审批事务已在锁等待');

  console.log(
    '\n=== 4. 另一个连接执行清理（与认证链套件 afterAll 完全相同的调用，不等待）===',
  );
  let cleanupSettled = null;
  const cleanup = cleaner.user
    .deleteMany({ where: { username: { startsWith: 't1a_' } } })
    .then(
      (result) => (cleanupSettled = { ok: true, result }),
      (error) => (cleanupSettled = { ok: false, error }),
    );
  const step = await waitFor('清理事务进入锁等待或结束', async () => {
    if (cleanupSettled) return { settled: true };
    return (await lockWaitText()).includes('user.PRIMARY')
      ? { waiting: true }
      : null;
  });

  const describeCleanup = () =>
    cleanupSettled?.ok
      ? `成功，删除 ${cleanupSettled.result.count} 个用户`
      : `失败 ${cleanupSettled?.error?.code ?? ''} ${cleanupSettled?.error?.message?.split('\n')[0] ?? ''}`;

  if (step.settled) {
    console.log('   清理没有进入锁等待就结束了，没有成环。');
    console.log(`   清理的结果：${describeCleanup()}`);
    console.log('   此刻的锁等待：');
    console.log(await lockWaitText());
    releasePause();
    const approvalResult = await approval;
    await Promise.all([cleanup, pauseTransaction]);
    console.log(
      `   放开暂停桩后审批：HTTP ${approvalResult.status}，${approvalResult.message ?? ''}`,
    );
    console.log('\n结论：没有发生死锁。');
    process.exitCode = 1;
    return;
  }

  console.log('   清理事务已在锁等待（等 user 行）。此刻的锁等待：');
  console.log(await lockWaitText());

  console.log(
    '\n=== 5. 放开暂停桩：审批的「插入通知」转而等清理事务，而成环 ===',
  );
  releasePause();
  const approvalResult = await approval;
  await Promise.all([cleanup, pauseTransaction]);
  const approvalDeadlocked = approvalResult.status === 500;
  console.log(
    `   审批：HTTP ${approvalResult.status}，code=${approvalResult.code}，${approvalResult.message ?? ''}`,
  );
  console.log(`   清理：${describeCleanup()}`);
  if (!approvalDeadlocked) {
    console.log('\n结论：没有发生死锁。');
    process.exitCode = 1;
    return;
  }

  console.log('\n=== 6. InnoDB 记录的死锁 ===');
  console.log(await latestDeadlock());

  console.log('\n=== 7. 事后状态 ===');
  const applicationRow = await monitor.teamApplication.findUniqueOrThrow({
    where: { id: BigInt(application.data.id) },
  });
  const postRow = await monitor.communityPost.findUniqueOrThrow({
    where: { id: BigInt(post.data.id) },
  });
  const teamCount = await monitor.team.count();
  const memberCount = await monitor.teamMember.count();
  console.log(
    `   申请状态=${applicationRow.status}，帖子进度=${postRow.recruitedCount}/${postRow.recruitTotal}、绑定课题组=${postRow.teamId ?? '无'}，` +
      `课题组数=${teamCount}，成员行数=${memberCount}`,
  );
  const intact =
    applicationRow.status === 'pending' &&
    postRow.recruitedCount === 0 &&
    postRow.teamId === null &&
    teamCount === 0 &&
    memberCount === 0;
  console.log(
    `   审批事务整体回滚，没有留下半截数据：${intact ? '是' : '否（存在半截数据，需要排查）'}`,
  );
  if (!intact) process.exitCode = 2;

  console.log('\n=== 8. 对照：没有并发清理时，同一笔审批直接成功 ===');
  const retry = await api(
    `/community/applications/${application.data.id}/approve`,
    {
      method: 'POST',
      token: author.token,
    },
  );
  console.log(
    `   HTTP ${retry.status}，code=${retry.code}，进度=${retry.data?.post?.recruitedCount}/${retry.data?.post?.recruitTotal}`,
  );
  if (retry.code !== 0) process.exitCode = 2;
  console.log('\n结论：死锁已复现，被回滚的是审批事务。');
}

/** 对照：只有审批事务并发（跨帖、同帖抢名额、首次通过建组同时发生），没有任何清理 */
async function stress() {
  const postsPerRound = 6;
  const applicantsPerPost = 6;
  const recruitTotal = 3;
  console.log(
    `=== 对照：${STRESS_ROUNDS} 轮，每轮 ${postsPerRound} 个帖子 × ${applicantsPerPost} 位申请人，${postsPerRound * applicantsPerPost} 笔审批同时发出 ===`,
  );
  const author = await register(`t1b_a_${SUFFIX}`);
  const applicants = [];
  for (let i = 0; i < applicantsPerPost; i++) {
    applicants.push(await register(`t1c_${i}_${SUFFIX}`));
  }
  const tags = await setupRequest('/community/tags', { token: author.token });
  const tagIds = tags.data.map((item) => item.id);

  const deadlocksBefore = await deadlocks();
  let passed = 0;
  let full = 0;
  let badResponses = 0;
  let badStates = 0;
  for (let round = 1; round <= STRESS_ROUNDS; round++) {
    const posts = [];
    for (let i = 0; i < postsPerRound; i++) {
      const res = await setupRequest('/community/posts', {
        method: 'POST',
        token: author.token,
        body: {
          title: `压测_${SUFFIX}_${round}_${i}`,
          tagIds: [tagIds[i % tagIds.length]],
          recruitTotal,
        },
      });
      posts.push(res.data);
    }
    const applications = [];
    for (const post of posts) {
      for (const applicant of applicants) {
        const res = await setupRequest(`/community/posts/${post.id}/apply`, {
          method: 'POST',
          token: applicant.token,
          body: { note: '' },
        });
        applications.push({ post, id: res.data.id });
      }
    }

    // 每帖 6 人抢 3 个名额：同帖的审批在帖子行上排队，不同帖的审批同时建组、入组、写通知
    const responses = await Promise.all(
      applications.map((item) =>
        api(`/community/applications/${item.id}/approve`, {
          method: 'POST',
          token: author.token,
        }),
      ),
    );
    for (const res of responses) {
      if (res.status === 201) passed++;
      else if (res.status === 409) full++;
      else {
        badResponses++;
        console.log(
          `   第 ${round} 轮出现非预期响应：HTTP ${res.status} ${res.message ?? ''}`,
        );
      }
    }

    for (const post of posts) {
      const postId = BigInt(post.id);
      const row = await monitor.communityPost.findUniqueOrThrow({
        where: { id: postId },
      });
      const teams = await monitor.team.count({ where: { name: post.title } });
      const members = await monitor.teamMember.count({
        where: { teamId: row.teamId },
      });
      const approved = await monitor.teamApplication.count({
        where: { postId, status: 'approved' },
      });
      const ok =
        row.recruitedCount === recruitTotal &&
        row.status === 'full' &&
        teams === 1 &&
        members === recruitTotal + 1 &&
        approved === recruitTotal;
      if (!ok) {
        badStates++;
        console.log(
          `   第 ${round} 轮帖子 #${post.id} 状态不对：进度 ${row.recruitedCount}/${row.recruitTotal}、状态 ${row.status}、` +
            `课题组数 ${teams}、组内 ${members} 人、已通过 ${approved} 条`,
        );
      }
    }
  }
  const deadlocksAfter = await deadlocks();
  console.log(
    `   审批 ${STRESS_ROUNDS * postsPerRound * applicantsPerPost} 笔：通过 ${passed}，名额不足 409 ${full}，` +
      `非预期响应 ${badResponses}；${STRESS_ROUNDS * postsPerRound} 个帖子里状态不对的 ${badStates} 个`,
  );
  console.log(`   InnoDB 死锁计数：${deadlocksBefore} → ${deadlocksAfter}`);
  const ok =
    badResponses === 0 && badStates === 0 && deadlocksAfter === deadlocksBefore;
  console.log(
    `\n结论：${ok ? '只有审批事务并发时没有成环，每帖恰好招满且只建一个课题组。' : '出现了异常，需要排查。'}`,
  );
  if (!ok) process.exitCode = 2;
}

try {
  const leftovers = await purgeLeftovers();
  if (leftovers) console.log(`清掉了上次运行遗留的 ${leftovers} 个用户`);
  if (process.argv.includes('--stress')) await stress();
  else await reproduce();
} catch (error) {
  console.error(`\n脚本异常：${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  await purgeLeftovers().catch((error) =>
    console.error(`收尾清理失败：${error?.message ?? error}`),
  );
  await Promise.all([
    pause.$disconnect(),
    cleaner.$disconnect(),
    monitor.$disconnect(),
  ]);
}
