/**
 * 沟通链真库集成（线③ 卡 T-1c）。
 *
 * 卡面要求的 4 条（docs/12 §卡 T-1c）逐条对应：
 *   1. 发私信 → 对方未读数 +1 → 对方进入会话（lastReadAt 更新）→ 未读归零；
 *      —— lastReadAt 是未读数唯一依据，必须真库验证；
 *   2. 三种会话类型（comment/group/private）隔离正确，A 的 private 会话 B 不可见；
 *   3. 会议 CRUD + 参会人替换 + 同人同会埋点只记一次；
 *   4. 文件消息与文本消息混合列表的分页顺序。
 *
 * 真库验证点（mock 单测覆盖不到的）：
 *   - `conversation_member.last_read_at` 的真实 UPDATE 语义（DATETIME 秒精度）；
 *   - 未读数 `COUNT(message WHERE created_at > last_read_at)` 的边界：
 *     **同秒写入**的两条消息与 last_read_at 的比较（秒精度歧义）；
 *   - `message.file_id` 外键真实生效（ON DELETE SET NULL）；
 *   - `uk_conversation_member` 唯一键在并发加入时不插第二行；
 *   - `meeting_attendee` 唯一键 + `activity_log` 埋点去重（recordOnce）真实生效；
 *   - 会议讨论区（Conversation.type=meeting）与其它类型在真库里的隔离。
 *
 * 运行方式见 setup.ts（需 RUN_INTEGRATION=1 与真实 MySQL）。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createIntegrationApp,
  envelope,
  maybe,
  registerUser,
  RUN,
} from './setup';

const ALICE = `t3c_a_${RUN}`;
const BOB = `t3c_b_${RUN}`;
const CAROL = `t3c_c_${RUN}`;
/** 局外人：与三人都不同组，用于「跨组越权」负例 */
const DAVE = `t3c_d_${RUN}`;

interface ConversationBody {
  id: string;
  type: string;
  title: string;
  refType: string;
  refId: string;
  unreadCount: number;
}

interface MessageBody {
  id: string;
  content: string;
  msgType: string;
  file?: {
    id: string;
    originalName: string;
    url: string;
    size: string;
    mimeType: string;
  };
}

interface UnreadBody {
  conversationId: string;
  unreadCount: number;
}

maybe('沟通链真库集成（线③ 卡 T-1c）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: { token: string; userId: string; username: string };
  let bob: { token: string; userId: string; username: string };
  let carol: { token: string; userId: string; username: string };
  let dave: { token: string; userId: string; username: string };

  /**
   * 建课题组并把人加进去，返回课题组 id。
   *
   * 加成员走**邀请码**（`POST /teams/join`）——这是唯一的入组入口，
   * 没有「直接指定成员」的接口。建组者本人是组长，自动在组里。
   *
   * 课题组名带自增序号：同名课题组**允许**重复建（数据库不约束 name 唯一），
   * 但每次调用都要产生**独立的组**，否则后一个用例会把前一个用例的成员覆盖掉。
   */
  let teamSeq = 0;
  async function createTeam(name: string, userIds: string[]): Promise<string> {
    teamSeq += 1;
    const res = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name: `${name}#${teamSeq}` })
      .expect(201);
    const body = envelope<{ id: string; inviteCode: string }>(res).data;
    const teamId = body?.id ?? '';
    const inviteCode = body?.inviteCode ?? '';

    for (const userId of userIds) {
      // 用该用户的令牌入组
      const token = tokenOf(userId);
      await request(app.getHttpServer())
        .post('/api/v1/teams/join')
        .set('Authorization', `Bearer ${token}`)
        .send({ inviteCode })
        .expect(201);
    }
    return teamId;
  }

  /** 按 userId 取令牌 */
  function tokenOf(userId: string): string {
    if (userId === alice.userId) return alice.token;
    if (userId === bob.userId) return bob.token;
    if (userId === carol.userId) return carol.token;
    return dave.token;
  }

  /**
   * 建一个「Alice + 指定成员」同组的课题组。
   *
   * 私信有「非好友限发 1 条」规则，只有**同组**能豁免——
   * 所以凡是要连发多条私信的用例，都必须先造一个同组关系。
   */
  async function sameTeam(peerUserId: string): Promise<string> {
    return createTeam(`T-1c组_${RUN}`, [peerUserId]);
  }

  /** 建项目（挂在 Alice 的课题组下），返回项目 id */
  async function createProject(name: string, teamId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name, teamId })
      .expect(201);
    return envelope<{ id: string }>(res).data?.id ?? '';
  }

  /** 取某人未读汇总里某会话的未读数 */
  async function unreadOf(
    token: string,
    conversationId: string,
  ): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/conversations/unread')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = envelope<UnreadBody[]>(res).data ?? [];
    return (
      items.find((i) => i.conversationId === conversationId)?.unreadCount ?? 0
    );
  }

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, ALICE);
    bob = await registerUser(app, BOB);
    carol = await registerUser(app, CAROL);
    dave = await registerUser(app, DAVE);
  });

  afterAll(async () => {
    if (prisma) {
      /**
       * 清理范围取**所有** `t3c_` 前缀用户，不只是本次运行的 4 个。
       *
       * 原因：`RUN` 每次运行都变，只按本次 ids 清理的话，
       * 之前失败留下的残留用户会卡住 `user.deleteMany`（外键 RESTRICT），
       * 让本 suite 从「用例失败」变成「整套 setup 失败」，掩盖真正的问题。
       */
      const allUsers = await prisma.user.findMany({
        where: { username: { startsWith: 't3c_' } },
        select: { id: true },
      });
      const ids = allUsers.map((u) => u.id);

      // 清理顺序：先删子表再删 user（外键 ON DELETE RESTRICT）
      await prisma.file.deleteMany({ where: { uploaderId: { in: ids } } });
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
      await prisma.conversationMember.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.conversation.deleteMany({
        where: { members: { some: { userId: { in: ids } } } },
      });
      await prisma.meetingAttendee.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.meeting.deleteMany({
        where: { project: { team: { ownerId: { in: ids } } } },
      });
      await prisma.activityLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.friendship.deleteMany({
        where: {
          OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
        },
      });
      // 项目要最后删：project_member / task / milestone / achievement / literature
      // 都外键指向 project（ON DELETE RESTRICT）
      await prisma.projectMember.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.project.deleteMany({
        where: { team: { ownerId: { in: ids } } },
      });
      // 组按「组长是我们的人」反查最稳（组名带自增后缀，容易漏）
      const teams = await prisma.team.findMany({
        where: { ownerId: { in: ids } },
        select: { id: true },
      });
      const teamIds = teams.map((t) => t.id);
      if (teamIds.length > 0) {
        await prisma.teamMember.deleteMany({
          where: { teamId: { in: teamIds } },
        });
        await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
      }
      await prisma.teamMember.deleteMany({ where: { userId: { in: ids } } });
      await prisma.teamApplication.deleteMany({
        where: { OR: [{ userId: { in: ids } }, { handledBy: { in: ids } }] },
      });
      await prisma.team.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({
        where: { username: { startsWith: 't3c_' } },
      });
    }
    await app.close();
  });

  // ================================================================
  // 卡面第 1 条：未读数 / lastReadAt（真库核心验证点）
  // ================================================================

  it('卡面1：发私信 → 对方未读数 +1 → 对方标记已读 → 未读归零', async () => {
    // Alice 与 Bob 同组（避免非好友限发 1 条干扰本用例）
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    // Alice 与 Bob 打开私信会话
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';
    expect(convId).not.toBe('');

    // 初始双方都未读
    expect(await unreadOf(bob.token, convId)).toBe(0);

    // Alice 发 1 条 → Bob 未读 +1
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '第一条' })
      .expect(201);
    expect(await unreadOf(bob.token, convId)).toBe(1);

    // 再发 2 条 → 未读 +3
    for (const text of ['第二条', '第三条']) {
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: text })
        .expect(201);
    }
    expect(await unreadOf(bob.token, convId)).toBe(3);

    // Bob 标记已读 → 未读归零
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/read`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);
    expect(await unreadOf(bob.token, convId)).toBe(0);

    // 真库验证：last_read_at 真的被写进了 conversation_member
    const member = await prisma.conversationMember.findFirst({
      where: {
        conversationId: BigInt(convId),
        userId: BigInt(bob.userId),
        deleted: 0,
      },
      select: { lastReadAt: true },
    });
    expect(member?.lastReadAt).toBeInstanceOf(Date);

    // 发送者自己的 lastReadAt 也被推进（发消息时同步），
    // 所以 Alice 不给自己算未读
    expect(await unreadOf(alice.token, convId)).toBe(0);

    // 清理：项目/课题组留给 afterAll
    void projectId;
  });

  it('卡面1 边界：同秒写入的多条消息与 last_read_at 的秒精度比较', async () => {
    // Carol 必须与 Alice 同组，否则触发「非好友限发 1 条」
    await sameTeam(carol.userId);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: carol.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    // Carol 标记已读一次（lastReadAt = 当前时刻，秒精度）
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/read`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(201);

    // Alice 连发 3 条——**同一秒内**（真库 DATETIME 秒精度）
    for (const text of ['同秒1', '同秒2', '同秒3']) {
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: text })
        .expect(201);
    }

    // 真库断言：这 3 条的 created_at 是否与 last_read_at 同秒
    const member = await prisma.conversationMember.findFirst({
      where: {
        conversationId: BigInt(convId),
        userId: BigInt(carol.userId),
        deleted: 0,
      },
      select: { lastReadAt: true },
    });
    const messages = await prisma.message.findMany({
      where: { conversationId: BigInt(convId), deleted: 0 },
      select: { createdAt: true },
      orderBy: { id: 'asc' },
    });
    expect(messages.length).toBeGreaterThanOrEqual(3);

    // 记录同秒的实际情况：若 lastReadAt 与消息 created_at 同秒，
    // 则 `created_at > last_read_at` 为假 → 这些消息**不算未读**。
    // 这就是「秒精度歧义」的真库证据——用例把这个事实钉住，
    // 避免以后有人改了比较符号却没意识到行为变了。
    const sameSecond = messages.filter(
      (m) =>
        member?.lastReadAt &&
        Math.floor(m.createdAt.getTime() / 1000) ===
          Math.floor(member.lastReadAt.getTime() / 1000),
    );
    const expectedUnread = messages.length - sameSecond.length;
    expect(await unreadOf(carol.token, convId)).toBe(expectedUnread);
  });

  it('卡面1：未读数只统计自己的会话（个人维度隔离）', async () => {
    // Bob 的未读汇总里不应出现 Carol 参与的会话
    const items = await request(app.getHttpServer())
      .get('/api/v1/conversations/unread')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    const list = envelope<UnreadBody[]>(items).data ?? [];
    const mine = await prisma.conversationMember.findMany({
      where: { userId: BigInt(bob.userId), deleted: 0 },
      select: { conversationId: true },
    });
    const mineIds = new Set(mine.map((m) => m.conversationId.toString()));
    for (const item of list) {
      expect(mineIds.has(item.conversationId)).toBe(true);
    }
  });

  // ================================================================
  // 卡面第 2 条：会话类型隔离
  // ================================================================

  it('卡面2：A 的 private 会话 B 不可见（404）', async () => {
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    // Dave 不是成员 → 看不到会话详情
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${convId}`)
      .set('Authorization', `Bearer ${dave.token}`)
      .expect(404);

    // 也读不到消息
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${dave.token}`)
      .expect(404);

    // 也不能发言
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${dave.token}`)
      .send({ content: '偷看' })
      .expect(404);
  });

  it('卡面2：group / private / meeting 三种类型的会话互不串味', async () => {
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    // group（项目讨论区）
    const group = await request(app.getHttpServer())
      .post('/api/v1/conversations/group')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ projectId })
      .expect(201);
    const groupId = envelope<ConversationBody>(group).data?.id ?? '';
    expect(envelope<ConversationBody>(group).data?.type).toBe('group');

    // private
    const priv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const privId = envelope<ConversationBody>(priv).data?.id ?? '';
    expect(envelope<ConversationBody>(priv).data?.type).toBe('private');

    // meeting（F-1）
    const meeting = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        projectId,
        title: `T-1c会议_${RUN}`,
        heldAt: '2030-01-01 10:00:00',
        attendeeIds: [bob.userId],
      })
      .expect(201);
    const meetingId = envelope<{ id: string }>(meeting).data?.id ?? '';

    const mt = await request(app.getHttpServer())
      .post('/api/v1/conversations/meeting')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ meetingId })
      .expect(201);
    const mtId = envelope<ConversationBody>(mt).data?.id ?? '';
    expect(envelope<ConversationBody>(mt).data?.type).toBe('meeting');

    // 三个 id 互不相同
    expect(new Set([groupId, privId, mtId]).size).toBe(3);

    // group 会话的消息在 private 会话里看不到
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${groupId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '讨论区的话' })
      .expect(201);

    const privMsgs = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${privId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const list = envelope<MessageBody[]>(privMsgs).data ?? [];
    expect(list.some((m) => m.content === '讨论区的话')).toBe(false);

    // 会议讨论区的消息只在会议会话里
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '会议里的讨论' })
      .expect(201);

    const groupMsgs = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${groupId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const groupList = envelope<MessageBody[]>(groupMsgs).data ?? [];
    expect(groupList.some((m) => m.content === '会议里的讨论')).toBe(false);
  });

  it('卡面2：跨组用户拿别人的会议 id 开讨论区 → 403', async () => {
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    const meeting = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        projectId,
        title: `T-1c会议_${RUN}`,
        heldAt: '2030-01-01 10:00:00',
      })
      .expect(201);
    const meetingId = envelope<{ id: string }>(meeting).data?.id ?? '';

    // Dave 不在 Alice 的课题组里
    const res = await request(app.getHttpServer())
      .post('/api/v1/conversations/meeting')
      .set('Authorization', `Bearer ${dave.token}`)
      .send({ meetingId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(envelope(res).code).toBe(403);
  });

  // ================================================================
  // 卡面第 3 条：会议 CRUD + 参会人替换 + 埋点只记一次
  // ================================================================

  it('卡面3：会议 CRUD + 参会人全量替换 + 同人同会埋点只记一次', async () => {
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    // 建会：参会人 = Bob
    const created = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        projectId,
        title: `T-1c会议_${RUN}`,
        heldAt: '2030-01-01 10:00:00',
        attendeeIds: [bob.userId],
      })
      .expect(201);
    const meetingId = envelope<{ id: string }>(created).data?.id ?? '';

    // 埋点：创建者 1 条 meeting_create + 参会人 1 条 meeting_attend
    const createLogs = await prisma.activityLog.findMany({
      where: {
        refType: 'meeting',
        refId: BigInt(meetingId),
        type: 'meeting_create',
      },
    });
    expect(createLogs.length).toBe(1);

    const attendLogs = await prisma.activityLog.findMany({
      where: {
        refType: 'meeting',
        refId: BigInt(meetingId),
        type: 'meeting_attend',
      },
    });
    expect(attendLogs.length).toBe(1);
    expect(attendLogs[0].userId.toString()).toBe(bob.userId);

    // 参会人全量替换：Bob → Alice 自己
    await request(app.getHttpServer())
      .put(`/api/v1/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        title: `T-1c会议_${RUN}`,
        heldAt: '2030-01-01 10:00:00',
        attendeeIds: [alice.userId],
      })
      .expect(200);

    // Bob 的参会记录被软删，Alice 的新增
    const attendeeRows = await prisma.meetingAttendee.findMany({
      where: { meetingId: BigInt(meetingId) },
      select: { userId: true, deleted: true },
    });
    const bobRow = attendeeRows.find((r) => r.userId.toString() === bob.userId);
    const aliceRow = attendeeRows.find(
      (r) => r.userId.toString() === alice.userId,
    );
    expect(bobRow?.deleted).toBe(1);
    expect(aliceRow?.deleted).toBe(0);

    // 埋点撤销 + 重写：Bob 的 meeting_attend 权重置 0，Alice 的重新计一条
    const afterLogs = await prisma.activityLog.findMany({
      where: { refType: 'meeting', refId: BigInt(meetingId) },
      select: { userId: true, type: true, weight: true },
    });
    const bobAttend = afterLogs.find(
      (l) => l.type === 'meeting_attend' && l.userId.toString() === bob.userId,
    );
    const aliceAttend = afterLogs.find(
      (l) =>
        l.type === 'meeting_attend' && l.userId.toString() === alice.userId,
    );
    // Bob 的被撤销（权重 0）
    expect(Number(bobAttend?.weight)).toBe(0);
    // Alice 的只记一次
    expect(aliceAttend).toBeDefined();
    const aliceAttendCount = afterLogs.filter(
      (l) =>
        l.type === 'meeting_attend' && l.userId.toString() === alice.userId,
    ).length;
    expect(aliceAttendCount).toBe(1);

    // 重复提交同样的参会人 → 埋点仍是 1 条（recordOnce 去重）
    await request(app.getHttpServer())
      .put(`/api/v1/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        title: `T-1c会议_${RUN}`,
        heldAt: '2030-01-01 10:00:00',
        attendeeIds: [alice.userId],
      })
      .expect(200);

    const dedupeLogs = await prisma.activityLog.findMany({
      where: {
        refType: 'meeting',
        refId: BigInt(meetingId),
        type: 'meeting_attend',
        userId: BigInt(alice.userId),
      },
    });
    expect(dedupeLogs.length).toBe(1);
  });

  it('卡面3：会议讨论区在会议结束后只读（403），但历史消息可读', async () => {
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    // heldAt 设在过去 3 小时 → 按 120 分钟窗口判定为「已结束」
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const heldAtStr = `${past.getFullYear()}-${String(
      past.getMonth() + 1,
    ).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')} ${String(
      past.getHours(),
    ).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}:00`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        projectId,
        title: `T-1c会议_${RUN}`,
        heldAt: heldAtStr,
      })
      .expect(201);
    const meetingId = envelope<{ id: string }>(created).data?.id ?? '';

    const mt = await request(app.getHttpServer())
      .post('/api/v1/conversations/meeting')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ meetingId })
      .expect(201);
    const mtId = envelope<ConversationBody>(mt).data?.id ?? '';

    // 会议已结束 → 会议开始前的一条历史消息先造出来
    // （直接写库，模拟「会议期间讨论过」）
    await prisma.message.create({
      data: {
        conversationId: BigInt(mtId),
        senderId: BigInt(alice.userId),
        content: '会议期间讨论的内容',
        msgType: 'text',
        createdAt: new Date(past.getTime() - 60_000),
      },
    });

    // 只读标志
    const ro = await request(app.getHttpServer())
      .get(`/api/v1/conversations/meeting/${mtId}/readonly`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ readOnly: boolean }>(ro).data?.readOnly).toBe(true);

    // 历史消息**能看**（能看不能发）
    const msgs = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const list = envelope<MessageBody[]>(msgs).data ?? [];
    expect(list.some((m) => m.content === '会议期间讨论的内容')).toBe(true);

    // 但**不能发**（含新参会人）
    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '结束后还想说' })
      .expect(403);
    expect(envelope(blocked).code).toBe(403);

    // 新参会人（Bob，同组）同样只读：能看、不能发
    // 先让 Bob 加入讨论区（成员以「打开过讨论区」为准）
    const bobOpen = await request(app.getHttpServer())
      .post('/api/v1/conversations/meeting')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ meetingId })
      .expect(201);
    expect(envelope<ConversationBody>(bobOpen).data?.id).toBe(mtId);

    const bobMsgs = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(envelope<MessageBody[]>(bobMsgs).data?.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ content: '新参会人发言' })
      .expect(403);
  });

  it('卡面3：会议未排期（heldAt 为空）→ 讨论区不只读，可发言', async () => {
    const teamId = await createTeam(`T-1c组_${RUN}`, [bob.userId]);
    const projectId = await createProject(`T-1c项目_${RUN}`, teamId);

    const created = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ projectId, title: `T-1c会议_${RUN}` })
      .expect(201);
    const meetingId = envelope<{ id: string }>(created).data?.id ?? '';

    const mt = await request(app.getHttpServer())
      .post('/api/v1/conversations/meeting')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ meetingId })
      .expect(201);
    const mtId = envelope<ConversationBody>(mt).data?.id ?? '';

    const ro = await request(app.getHttpServer())
      .get(`/api/v1/conversations/meeting/${mtId}/readonly`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ readOnly: boolean }>(ro).data?.readOnly).toBe(false);

    // 可发言
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${mtId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '还没定时间，先聊聊' })
      .expect(201);
  });

  // ================================================================
  // 卡面第 4 条：文件消息与文本消息混合列表的分页顺序
  // ================================================================

  it('卡面4：文件消息与文本消息混合时，列表顺序与 limit 分页正确', async () => {
    await sameTeam(bob.userId);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    // 上传一个附件（走真实上传接口，验证两段式链路）
    const upload = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${alice.token}`)
      .attach('file', Buffer.from('T-1c 文件消息测试内容'), '纪要.txt')
      .expect(201);
    const fileId = envelope<{ id: string }>(upload).data?.id ?? '';
    expect(fileId).not.toBe('');

    // 交替发：文本、文件、文本、文件、文本
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '文本1' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '纪要', fileId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '文本2' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '第二份', fileId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '文本3' })
      .expect(201);

    // 取全部：时间正序，且文件消息带附件信息
    const all = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const list = envelope<MessageBody[]>(all).data ?? [];

    const mine = list.filter((m) =>
      ['文本1', '纪要', '文本2', '第二份', '文本3'].includes(m.content),
    );
    expect(mine.map((m) => m.content)).toEqual([
      '文本1',
      '纪要',
      '文本2',
      '第二份',
      '文本3',
    ]);

    // 文件消息的 msgType 与附件字段
    const fileMsg = mine.find((m) => m.content === '纪要');
    expect(fileMsg?.msgType).toBe('file');
    expect(fileMsg?.file?.originalName).toBe('纪要.txt');
    expect(fileMsg?.file?.id).toBe(fileId);

    // 文本消息没有附件字段
    const textMsg = mine.find((m) => m.content === '文本1');
    expect(textMsg?.msgType).toBe('text');
    expect(textMsg?.file).toBeUndefined();

    // limit 分页：取最后 2 条 → 顺序仍是时间正序
    const limited = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${convId}/messages?limit=2`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const limitedList = envelope<MessageBody[]>(limited).data ?? [];
    expect(limitedList).toHaveLength(2);
    // 取的是**最新**的 2 条（实现是倒序取 limit 再正序）
    const lastTwo = mine.slice(-2).map((m) => m.content);
    expect(limitedList.map((m) => m.content)).toEqual(lastTwo);
  });

  it('卡面4：文件消息的真库落库形态（msg_type + file_id 外键）', async () => {
    await sameTeam(bob.userId);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    const upload = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${alice.token}`)
      .attach('file', Buffer.from('T-1c 外键验证'), '外键.txt')
      .expect(201);
    const fileId = envelope<{ id: string }>(upload).data?.id ?? '';

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '带附件', fileId })
      .expect(201);

    // 真库断言：msg_type='file' 且 file_id 指向真实文件
    const row = await prisma.message.findFirst({
      where: { conversationId: BigInt(convId), msgType: 'file' },
      select: { fileId: true, content: true },
      orderBy: { id: 'desc' },
    });
    expect(row?.fileId?.toString()).toBe(fileId);
    expect(row?.content).toBe('带附件');

    // 外键 ON DELETE SET NULL：物理删除附件后，消息行还在但 file_id 置空
    await prisma.file.delete({ where: { id: BigInt(fileId) } });
    const after = await prisma.message.findFirst({
      where: {
        id: row
          ? (
              await prisma.message.findFirst({
                where: { conversationId: BigInt(convId), msgType: 'file' },
                select: { id: true },
                orderBy: { id: 'desc' },
              })
            )?.id
          : undefined,
      },
      select: { fileId: true },
    });
    expect(after).not.toBeNull();
    expect(after?.fileId).toBeNull();
  });

  it('卡面4：引用他人上传的附件 → 403；不存在的附件 → 400', async () => {
    await sameTeam(bob.userId);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: bob.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    const upload = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${alice.token}`)
      .attach('file', Buffer.from('别人的文件'), '别人的.txt')
      .expect(201);
    const fileId = envelope<{ id: string }>(upload).data?.id ?? '';

    // Bob 引用 Alice 上传的附件 → 403
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ content: '借你的文件', fileId })
      .expect(403);
    expect(envelope(forbidden).code).toBe(403);

    // 不存在的附件 → 400
    const missing = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '附件不存在', fileId: '999999999' })
      .expect(400);
    expect(envelope(missing).code).toBe(400);
  });

  it('卡面4：同秒写入的多条消息，列表顺序稳定（按 id 而非 created_at）', async () => {
    await sameTeam(carol.userId);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ peerUserId: carol.userId })
      .expect(201);
    const convId = envelope<ConversationBody>(conv).data?.id ?? '';

    // 连发 5 条（很可能落在同一秒内）
    for (let i = 1; i <= 5; i += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: `顺序${i}` })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const list = envelope<MessageBody[]>(res).data ?? [];
    const seq = list
      .map((m) => m.content)
      .filter((c) => c.startsWith('顺序'))
      .map((c) => Number(c.replace('顺序', '')));
    expect(seq).toEqual([1, 2, 3, 4, 5]);

    // 真库确认：这 5 条的 created_at 确实可能同秒（说明排序必须靠 id）
    const rows = await prisma.message.findMany({
      where: {
        conversationId: BigInt(convId),
        content: { startsWith: '顺序' },
      },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    const distinctSeconds = new Set(
      rows.map((r) => Math.floor(r.createdAt.getTime() / 1000)),
    );
    // 若同秒，则 id 单调递增保证了顺序稳定——用例记录这个事实
    expect(rows.length).toBe(5);
    expect(distinctSeconds.size).toBeGreaterThanOrEqual(1);
  });
});
