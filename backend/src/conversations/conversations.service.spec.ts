import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';

/** 消息行快照 */
interface MessageRow {
  id: bigint;
  conversationId: bigint;
  senderId: bigint;
  content: string;
  msgType: string;
  createdAt: Date;
  sender: { username: string; nickname: string };
  /** 附件快照（文件消息才有；附件被逻辑删除时后端不下发 file 字段） */
  file?: {
    id: bigint;
    originalName: string;
    url: string | null;
    size: bigint;
    mimeType: string | null;
    deleted: number;
  } | null;
}

function createService() {
  const tx = {
    message: {
      create: jest.fn<Promise<MessageRow>, [unknown]>(),
    },
    conversation: {
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
    conversationMember: {
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
  };
  const prisma = {
    conversation: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      create: jest.fn<Promise<{ id: bigint }>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
    conversationMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
    message: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
    },
    meeting: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    file: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
    },
    friendship: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    user: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    project: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const service = new ConversationsService(prisma as unknown as PrismaService);
  return { service, prisma, tx };
}

describe('ConversationsService.ensureGroupConversation', () => {
  it('项目不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      service.ensureGroupConversation('1', { projectId: '99' }),
    ).rejects.toMatchObject({ code: 404, message: '项目不存在' });
  });

  it('不是团队成员 → 403', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(
      service.ensureGroupConversation('1', { projectId: '3' }),
    ).rejects.toMatchObject({ code: 403 });
  });
});

describe('ConversationsService.ensurePrivateConversation', () => {
  it('自己和自己 → 400', async () => {
    const { service } = createService();
    await expect(
      service.ensurePrivateConversation('1', { peerUserId: '1' }),
    ).rejects.toMatchObject({ code: 400 });
  });

  /**
   * 线③ 卡 E-3 改了口径：私信不再要求同组，
   * 任何登录用户都能给任何其他登录用户发私信（首次打招呼模式）。
   */
  it('对方不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.ensurePrivateConversation('1', { peerUserId: '2' }),
    ).rejects.toMatchObject({ code: 404, message: '用户不存在' });
  });

  it('对方与我不在同一课题组 → 仍可创建（不再要求同组）', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({ id: 2n });
    prisma.teamMember.findMany.mockResolvedValue([{ teamId: 7n }]);
    prisma.teamMember.findFirst.mockResolvedValue(null); // 对方不在本组
    prisma.conversation.findFirst.mockResolvedValue(null); // 尚无会话
    prisma.conversation.create.mockResolvedValue({ id: 5n });
    prisma.conversationMember.findFirst.mockResolvedValue(null);
    prisma.conversationMember.create.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue({
      id: 5n,
      type: 'private',
      title: null,
      refType: null,
      refId: null,
      updatedAt: new Date('2026-11-23T02:00:00Z'),
      members: [{ lastReadAt: null }],
    });
    prisma.conversationMember.findMany.mockResolvedValue([
      {
        conversationId: 5n,
        user: { username: 'lisi', nickname: '李四' },
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.count.mockResolvedValue(0);

    const result = await service.ensurePrivateConversation('1', {
      peerUserId: '2',
    });
    expect(result.id).toBe('5');
  });
});

describe('ConversationsService.sendConversationMessage', () => {
  it('发消息：写 message + 刷新 conversation.updatedAt + 推进发送者 lastReadAt，且不写埋点', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    tx.message.create.mockResolvedValue({
      id: 100n,
      conversationId: 5n,
      senderId: 1n,
      content: 'hello',
      msgType: 'text',
      createdAt: new Date('2026-11-11T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
    });

    const result = await service.sendConversationMessage('1', '5', 'hello');

    expect(result.id).toBe('100');
    expect(result.content).toBe('hello');

    // 读 mock.calls 显式断言，避免 expect.any(Date) 触发 no-unsafe-assignment
    const updateCalls = tx.conversation.update.mock.calls as unknown as Array<
      [{ where: { id: bigint }; data: { updatedAt: Date } }]
    >;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].where).toEqual({ id: 5n });
    expect(updateCalls[0][0].data.updatedAt).toBeInstanceOf(Date);

    const readCalls = tx.conversationMember.updateMany.mock
      .calls as unknown as Array<
      [
        {
          where: {
            conversationId: bigint;
            userId: bigint;
            deleted: number;
          };
          data: { lastReadAt: Date };
        },
      ]
    >;
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0][0].where).toEqual({
      conversationId: 5n,
      userId: 1n,
      deleted: 0,
    });
    expect(readCalls[0][0].data.lastReadAt).toBeInstanceOf(Date);

    // 零埋点：tx 里根本没有 activityLog
    expect(tx).not.toHaveProperty('activityLog');
  });
});

describe('ConversationsService.listUnread', () => {
  it('按 lastReadAt 统计未读数', async () => {
    const { service, prisma } = createService();
    prisma.conversationMember.findMany.mockResolvedValue([
      {
        conversationId: 5n,
        lastReadAt: new Date('2026-11-11T00:00:00Z'),
      },
      { conversationId: 6n, lastReadAt: null },
    ]);
    prisma.message.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const result = await service.listUnread('1');
    expect(result).toEqual([{ conversationId: '5', unreadCount: 3 }]);

    const countCalls = prisma.message.count.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    expect(countCalls).toHaveLength(2);
    expect(countCalls[1][0].where).toEqual({
      conversationId: 6n,
      deleted: 0,
    });
  });
});

describe('ConversationsService.markRead', () => {
  it('非会话成员 → 404', async () => {
    const { service, prisma } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue(null);
    await expect(service.markRead('1', '5')).rejects.toMatchObject({
      code: 404,
      message: '会话不存在',
    });
  });
});

describe('ConversationsService.listConversations', () => {
  it('private 会话按查看者解析对方昵称作 title（共享 title 列为空）', async () => {
    const { service, prisma } = createService();
    prisma.conversation.count.mockResolvedValue(1);
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 9n,
        type: 'private',
        title: null,
        refType: 'private',
        refId: null,
        updatedAt: new Date('2026-11-17T10:00:00Z'),
        members: [{ lastReadAt: null }],
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.count.mockResolvedValue(2);
    // fillPrivateTitles：查列表内 private 会话的对方成员（一次 in 查询，排除查看者）
    prisma.conversationMember.findMany.mockResolvedValue([
      {
        conversationId: 9n,
        user: { username: 'c5mate', nickname: 'C5 Mate' },
      },
    ]);

    const result = await service.listConversations('1', {});
    expect(result.total).toBe(1);
    expect(result.list[0].title).toBe('C5 Mate');
    expect(result.list[0].unreadCount).toBe(2);
    expect(result.list[0].lastMessage).toBe('');

    const peerQuery = prisma.conversationMember.findMany.mock.calls[0][0] as {
      where: {
        conversationId: { in: bigint[] };
        userId: { not: bigint };
        deleted: number;
      };
    };
    expect(peerQuery.where.conversationId.in).toEqual([9n]);
    expect(peerQuery.where.userId.not).toBe(1n);
  });

  it('非 private 会话不触发对方成员查询', async () => {
    const { service, prisma } = createService();
    prisma.conversation.count.mockResolvedValue(1);
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 10n,
        type: 'group',
        title: 'C5 Verify Project',
        refType: 'project',
        refId: 1n,
        updatedAt: new Date('2026-11-17T10:00:00Z'),
        members: [{ lastReadAt: null }],
      },
    ]);
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.count.mockResolvedValue(0);

    const result = await service.listConversations('1', {});
    expect(result.list[0].title).toBe('C5 Verify Project');
    expect(prisma.conversationMember.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 线③ 卡 F-1：会议讨论区
// ---------------------------------------------------------------------------

describe('ConversationsService.ensureMeetingConversation', () => {
  it('会议不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.meeting.findFirst.mockResolvedValue(null);
    await expect(
      service.ensureMeetingConversation('1', { meetingId: '99' }),
    ).rejects.toMatchObject({ code: 404, message: '会议不存在' });
  });

  it('会议所属项目已被逻辑删除 → 404', async () => {
    const { service, prisma } = createService();
    prisma.meeting.findFirst.mockResolvedValue({
      id: 3n,
      title: '需求评审',
      project: { id: 1n, name: 'P', teamId: 7n, deleted: 1 },
    });
    await expect(
      service.ensureMeetingConversation('1', { meetingId: '3' }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('不是会议所属团队的成员 → 403', async () => {
    const { service, prisma } = createService();
    prisma.meeting.findFirst.mockResolvedValue({
      id: 3n,
      title: '需求评审',
      project: { id: 1n, name: 'P', teamId: 7n, deleted: 0 },
    });
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(
      service.ensureMeetingConversation('1', { meetingId: '3' }),
    ).rejects.toMatchObject({ code: 403 });
  });

  it('创建/获取 meeting 类型会话，refType/refId 指向会议，title 带会议名', async () => {
    const { service, prisma } = createService();
    prisma.meeting.findFirst.mockResolvedValue({
      id: 3n,
      title: '需求评审',
      project: { id: 1n, name: 'P', teamId: 7n, deleted: 0 },
    });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    prisma.conversation.findFirst.mockResolvedValueOnce(null); // 尚无会话
    prisma.conversation.create.mockResolvedValue({ id: 20n });
    prisma.conversationMember.findFirst.mockResolvedValue(null);
    prisma.conversationMember.create.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue({
      id: 20n,
      type: 'meeting',
      title: '会议「需求评审」讨论区',
      refType: 'meeting',
      refId: 3n,
      updatedAt: new Date('2026-11-27T10:00:00Z'),
      members: [{ lastReadAt: null }],
    });
    prisma.message.findFirst.mockResolvedValue(null);
    prisma.message.count.mockResolvedValue(0);

    const result = await service.ensureMeetingConversation('1', {
      meetingId: '3',
    });
    expect(result.id).toBe('20');
    expect(result.type).toBe('meeting');

    const createCalls = prisma.conversation.create.mock
      .calls as unknown as Array<
      [
        {
          data: { type: string; refType: string; refId: bigint; title: string };
        },
      ]
    >;
    expect(createCalls[0][0].data.type).toBe('meeting');
    expect(createCalls[0][0].data.refType).toBe('meeting');
    expect(createCalls[0][0].data.refId).toBe(3n);
  });
});

describe('ConversationsService.assertMessageAllowed（会议讨论区只读）', () => {
  /** 构造一个已结束的会议（开始时间在 3 小时前，超过 120 分钟窗口） */
  const endedMeeting = {
    heldAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  };

  it('会议已结束 → 403（讨论区只读）', async () => {
    const { service, prisma } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'meeting',
      refId: 3n,
    });
    prisma.meeting.findFirst.mockResolvedValue(endedMeeting);

    await expect(
      service.sendConversationMessage('1', '5', '还能说吗'),
    ).rejects.toMatchObject({
      code: 403,
      message: '会议已结束，讨论区只读，不能再发言',
    });
  });

  it('会议进行中 → 允许发言', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'meeting',
      refId: 3n,
    });
    prisma.meeting.findFirst.mockResolvedValue({
      heldAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    tx.message.create.mockResolvedValue({
      id: 100n,
      conversationId: 5n,
      senderId: 1n,
      content: '还能说',
      msgType: 'text',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
    });

    const result = await service.sendConversationMessage('1', '5', '还能说');
    expect(result.id).toBe('100');
  });

  it('会议未排期（heldAt 为空）→ 不算结束，可发言', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'meeting',
      refId: 3n,
    });
    prisma.meeting.findFirst.mockResolvedValue({ heldAt: null });
    tx.message.create.mockResolvedValue({
      id: 101n,
      conversationId: 5n,
      senderId: 1n,
      content: '待定会议也能聊',
      msgType: 'text',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
    });

    const result = await service.sendConversationMessage(
      '1',
      '5',
      '待定会议也能聊',
    );
    expect(result.id).toBe('101');
  });

  it('private 会话不受会议只读规则影响（不查 meeting 表）', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'private',
      refId: null,
    });
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.message.count.mockResolvedValue(0); // 该方向还没发过 → 不限流
    tx.message.create.mockResolvedValue({
      id: 102n,
      conversationId: 5n,
      senderId: 1n,
      content: '私信照常',
      msgType: 'text',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
    });

    const result = await service.sendConversationMessage('1', '5', '私信照常');
    expect(result.id).toBe('102');
    expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 线③ 收尾：文件消息
// ---------------------------------------------------------------------------

describe('ConversationsService.sendConversationMessage（文件消息）', () => {
  it('带 fileId → msgType 为 file，并写 file_id', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'group',
      refId: null,
    });
    prisma.file.findFirst.mockResolvedValue({ id: 8n, uploaderId: 1n });
    tx.message.create.mockResolvedValue({
      id: 200n,
      conversationId: 5n,
      senderId: 1n,
      content: '会议纪要',
      msgType: 'file',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
      file: {
        id: 8n,
        originalName: '纪要.pdf',
        url: '/api/v1/files/2026/11/27/abc.pdf',
        size: 1024n,
        mimeType: 'application/pdf',
        deleted: 0,
      },
    });

    const result = await service.sendConversationMessage(
      '1',
      '5',
      '会议纪要',
      '8',
    );

    expect(result.msgType).toBe('file');
    expect(result.file?.originalName).toBe('纪要.pdf');
    expect(result.file?.url).toBe('/api/v1/files/2026/11/27/abc.pdf');
    expect(result.file?.size).toBe('1024');

    const createCalls = tx.message.create.mock.calls as unknown as Array<
      [{ data: { msgType: string; fileId?: bigint } }]
    >;
    expect(createCalls[0][0].data.msgType).toBe('file');
    expect(createCalls[0][0].data.fileId).toBe(8n);
  });

  it('附件不存在 → 400', async () => {
    const { service, prisma } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'group',
      refId: null,
    });
    prisma.file.findFirst.mockResolvedValue(null);
    await expect(
      service.sendConversationMessage('1', '5', '附件', '8'),
    ).rejects.toMatchObject({ code: 400, message: '附件不存在' });
  });

  it('引用他人上传的附件 → 403', async () => {
    const { service, prisma } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'group',
      refId: null,
    });
    prisma.file.findFirst.mockResolvedValue({ id: 8n, uploaderId: 99n });
    await expect(
      service.sendConversationMessage('1', '5', '附件', '8'),
    ).rejects.toMatchObject({
      code: 403,
      message: '只能发送自己上传的附件',
    });
  });

  it('不带 fileId → 普通文本消息，不写 file_id', async () => {
    const { service, prisma, tx } = createService();
    prisma.conversationMember.findFirst.mockResolvedValue({ id: 1n });
    prisma.conversation.findFirst.mockResolvedValue({
      type: 'group',
      refId: null,
    });
    tx.message.create.mockResolvedValue({
      id: 201n,
      conversationId: 5n,
      senderId: 1n,
      content: '纯文本',
      msgType: 'text',
      createdAt: new Date('2026-11-27T10:00:00Z'),
      sender: { username: 'zhangsan', nickname: '张三' },
    });

    const result = await service.sendConversationMessage('1', '5', '纯文本');
    expect(result.msgType).toBe('text');
    expect(result.file).toBeUndefined();
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });

  it('附件被逻辑删除 → 不返回 file 字段（前端降级为纯文本，不给死链）', async () => {
    const { service, prisma } = createService();
    prisma.message.findMany.mockResolvedValue([
      {
        id: 300n,
        conversationId: 5n,
        senderId: 1n,
        content: '已删除的附件',
        msgType: 'file',
        createdAt: new Date('2026-11-27T10:00:00Z'),
        sender: { username: 'zhangsan', nickname: '张三' },
        file: {
          id: 8n,
          originalName: '纪要.pdf',
          url: '/api/v1/files/2026/11/27/abc.pdf',
          size: 1024n,
          mimeType: 'application/pdf',
          deleted: 1,
        },
      },
    ]);

    const result = await service.listMessages(5n, 50);
    expect(result[0].msgType).toBe('file');
    expect(result[0].file).toBeUndefined();
  });
});
