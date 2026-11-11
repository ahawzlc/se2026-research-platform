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
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
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

  it('对方不在同一课题组 → 403', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findMany.mockResolvedValue([{ teamId: 7n }]);
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(
      service.ensurePrivateConversation('1', { peerUserId: '2' }),
    ).rejects.toMatchObject({ code: 403 });
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
          where: { conversationId: bigint; userId: bigint };
          data: { lastReadAt: Date };
        },
      ]
    >;
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0][0].where).toEqual({ conversationId: 5n, userId: 1n });
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
