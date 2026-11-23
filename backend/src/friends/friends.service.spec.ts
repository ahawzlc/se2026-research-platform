import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** friendship 表一行快照 */
function buildFriendship(overrides: Record<string, unknown> = {}) {
  return {
    id: 50n,
    requesterId: 1n,
    addresseeId: 2n,
    status: 'pending',
    handledAt: null,
    createdAt: new Date('2026-11-23T02:00:00Z'),
    updatedAt: new Date('2026-11-23T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

/** user 表一行快照 */
function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 2n,
    username: 'lisi',
    nickname: '李四',
    avatar: '',
    email: 'li@example.com',
    passwordHash: 'HASH',
    publicUid: 'U0000000002',
    bio: '我是李四',
    profileVisibility: 'public',
    createdAt: new Date('2026-11-23T02:00:00Z'),
    updatedAt: new Date('2026-11-23T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    friendship: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const notifications = { push: jest.fn() };
  const service = new FriendsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

/**
 * 让 friendship.findFirst 按查询条件返回不同的行。
 *
 * 服务层在一次调用里会问三个不同的问题（areFriends / 反向 pending / 我发起的方向），
 * 用 mockResolvedValueOnce 按顺序返回容易错位，故按 where 的具体取值分派：
 *   - status==='accepted'        → areFriends 查询
 *   - requester=对方 & addressee=我 → 反向 pending 查询
 *   - requester=我 & addressee=对方 → 我发起的方向
 */
function stubFriendshipLookup(
  prisma: { friendship: { findFirst: jest.Mock } },
  rules: {
    accepted?: Record<string, unknown> | null;
    reversePending?: Record<string, unknown> | null;
    outgoing?: Record<string, unknown> | null;
  },
): void {
  const ME = 1n;
  const PEER = 2n;
  prisma.friendship.findFirst.mockImplementation(
    (args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if (where.status === 'accepted') {
        return Promise.resolve(rules.accepted ?? null);
      }
      if (where.requesterId === PEER && where.addresseeId === ME) {
        return Promise.resolve(rules.reversePending ?? null);
      }
      if (where.requesterId === ME && where.addresseeId === PEER) {
        return Promise.resolve(rules.outgoing ?? null);
      }
      return Promise.resolve(null);
    },
  );
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('FriendsService.createRequest', () => {
  it('发起申请：新建 pending 行并给对方发通知', async () => {
    const { service, prisma, notifications } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });
    notifications.push.mockResolvedValue({});

    const result = await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: 1n, addresseeId: 2n, status: 'pending' },
      select: { id: true },
    });
    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'friend_request',
        refType: 'friendship',
      }),
    );
    expect(result.direction).toBe('outgoing');
  });

  it('UID 不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000999' }),
      404,
      '该 UID 不存在',
    );
  });

  it('不能加自己为好友 → 400', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser({ id: 1n }));
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000001' }),
      400,
      '不能添加自己为好友',
    );
  });

  it('已是好友 → 409', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      accepted: buildFriendship({
        status: 'accepted',
        requesterId: 2n,
        addresseeId: 1n,
      }),
    });
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '你们已经是好友了',
    );
  });

  it('对方已申请我 → 409（不重复插入）', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      reversePending: buildFriendship({
        requesterId: 2n,
        addresseeId: 1n,
        status: 'pending',
      }),
    });
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '对方已向你发起好友申请，请去「好友申请」处理',
    );
    expect(prisma.friendship.create).not.toHaveBeenCalled();
  });

  it('我已申请过且仍 pending → 409', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      outgoing: buildFriendship({ status: 'pending' }),
    });
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '好友申请已发出，等待对方处理',
    );
  });

  it('被拒后可再次申请：复用同一行改回 pending', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      outgoing: buildFriendship({ status: 'rejected' }),
    });
    prisma.friendship.update.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 50n },
      data: { status: 'pending', handledAt: null, deleted: 0 },
    });
  });
});

describe('FriendsService.acceptRequest', () => {
  it('同意：把 pending 行改成 accepted 并通知申请方', async () => {
    const { service, prisma, notifications } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ requester: buildUser({ id: 1n, nickname: '张三' }) }),
    );
    prisma.friendship.update.mockResolvedValue({});
    notifications.push.mockResolvedValue({});

    const result = await service.acceptRequest('2', '50');

    // 读 mock.calls 显式断言，避免 expect.any(Date) 触发 no-unsafe-assignment
    const updateCalls = prisma.friendship.update.mock.calls as unknown as Array<
      [{ data: { status: string; handledAt: Date } }]
    >;
    expect(updateCalls[0][0].data.status).toBe('accepted');
    expect(updateCalls[0][0].data.handledAt).toBeInstanceOf(Date);
    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'friend_accepted' }),
    );
    expect(result.id).toBe('1');
  });

  it('不是接收方 → 404（不能替别人同意）', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(buildFriendship());
    await expectBizError(
      service.acceptRequest('3', '50'),
      404,
      '好友申请不存在',
    );
    expect(prisma.friendship.update).not.toHaveBeenCalled();
  });

  it('已同意过 → 幂等返回好友信息', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({
        status: 'accepted',
        requester: buildUser({ id: 1n }),
      }),
    );
    const result = await service.acceptRequest('2', '50');
    expect(result.id).toBe('1');
    expect(prisma.friendship.update).not.toHaveBeenCalled();
  });
});

describe('FriendsService.rejectRequest', () => {
  it('拒绝：改成 rejected，不删行、不发通知', async () => {
    const { service, prisma, notifications } = createService();
    prisma.friendship.findFirst.mockResolvedValue(buildFriendship());
    prisma.friendship.update.mockResolvedValue({});

    await service.rejectRequest('2', '50');

    // 读 mock.calls 显式断言，避免 expect.any(Date) 触发 no-unsafe-assignment
    const updateCalls = prisma.friendship.update.mock.calls as unknown as Array<
      [{ data: { status: string; handledAt: Date } }]
    >;
    expect(updateCalls[0][0].data.status).toBe('rejected');
    expect(updateCalls[0][0].data.handledAt).toBeInstanceOf(Date);
    expect(notifications.push).not.toHaveBeenCalled();
  });

  it('已是好友不能拒绝 → 409', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ status: 'accepted' }),
    );
    await expectBizError(
      service.rejectRequest('2', '50'),
      409,
      '已是好友，不能拒绝',
    );
  });
});

describe('FriendsService.removeFriend', () => {
  it('删除好友：把双向关系一并逻辑删除', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ status: 'accepted' }),
    );
    prisma.friendship.updateMany.mockResolvedValue({ count: 1 });

    await service.removeFriend('1', '2');

    expect(prisma.friendship.updateMany).toHaveBeenCalledWith({
      where: {
        deleted: 0,
        OR: [
          { requesterId: 1n, addresseeId: 2n },
          { requesterId: 2n, addresseeId: 1n },
        ],
      },
      data: { deleted: 1 },
    });
  });

  it('不是好友 → 404', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(null);
    await expectBizError(service.removeFriend('1', '2'), 404, '好友不存在');
  });
});

describe('FriendsService.listFriends', () => {
  it('返回 accepted 关系里的对端（排除自己）', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 1n, addresseeId: 2n, status: 'accepted' },
      { requesterId: 3n, addresseeId: 1n, status: 'accepted' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      buildUser({ id: 2n, nickname: '李四' }),
      buildUser({ id: 3n, nickname: '王五', publicUid: 'U0000000003' }),
    ]);

    const result = await service.listFriends('1');

    expect(result.total).toBe(2);
    expect(result.list.map((f) => f.id)).toEqual(['2', '3']);
  });

  it('没有好友 → 空列表而非报错', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findMany.mockResolvedValue([]);
    const result = await service.listFriends('1');
    expect(result).toEqual({ list: [], total: 0 });
  });
});
