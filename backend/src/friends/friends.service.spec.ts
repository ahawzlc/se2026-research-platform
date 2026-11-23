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
      deleteMany: jest.fn(),
    },
    // 真实 Prisma 的 $transaction 接收 PrismaPromise 数组，等价于 Promise.all
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const notifications = { push: jest.fn() };
  const service = new FriendsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

/**
 * 让 friendship 查询按 where 的具体取值分派。
 *
 * 服务层会问三类问题，故按 where 形状分派：
 *   - `findFirst` + status==='accepted'  → areFriends（是否已是好友）
 *   - `findMany` + where 只有 OR        → listFriendshipsBetween（两人之间的全部关系行，双向）
 *   - `findMany` + status==='accepted'  → listFriends（好友列表）
 */
function stubFriendshipLookup(
  prisma: {
    friendship: { findFirst: jest.Mock; findMany: jest.Mock };
  },
  rules: {
    accepted?: Record<string, unknown> | null;
    /** 两人之间的全部关系行（双向，含软删） */
    rows?: Record<string, unknown>[];
    /** listFriends 用的好友行 */
    friendRows?: Record<string, unknown>[];
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
      return Promise.resolve(null);
    },
  );
  prisma.friendship.findMany.mockImplementation(
    (args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if (where.status === 'accepted') {
        return Promise.resolve(rules.friendRows ?? []);
      }
      if (where.OR) {
        // listFriendshipsBetween：双向查 (ME,PEER) 与 (PEER,ME)
        const orList = where.OR as Array<Record<string, unknown>>;
        const wanted = new Set(
          orList.map(
            (o) => `${String(o.requesterId)}:${String(o.addresseeId)}`,
          ),
        );
        const matched = (rules.rows ?? []).filter((row) =>
          wanted.has(`${String(row.requesterId)}:${String(row.addresseeId)}`),
        );
        void ME;
        void PEER;
        return Promise.resolve(matched);
      }
      return Promise.resolve([]);
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
      rows: [
        buildFriendship({
          requesterId: 2n,
          addresseeId: 1n,
          status: 'pending',
        }),
      ],
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
      rows: [buildFriendship({ status: 'pending' })],
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
      rows: [buildFriendship({ status: 'rejected' })],
    });
    prisma.friendship.update.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 50n },
      data: {
        requesterId: 1n,
        addresseeId: 2n,
        status: 'pending',
        handledAt: null,
        deleted: 0,
      },
    });
  });

  /**
   * 回归：删除好友后重新加。
   *
   * `uk_friendship` 唯一键不区分 deleted，逻辑删除的行仍占着键——
   * 若查找时按 `deleted: 0` 过滤，就会去 create 新行并撞唯一约束（500）。
   * 故必须把已软删的行也找出来并复活。
   */
  it('删除好友后可重新加：复活已软删的行，不 create 新行', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      rows: [buildFriendship({ status: 'accepted', deleted: 1 })],
    });
    prisma.friendship.update.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 50n },
      data: {
        requesterId: 1n,
        addresseeId: 2n,
        status: 'pending',
        handledAt: null,
        deleted: 0,
      },
    });
  });

  it('已软删且状态仍是 pending 的行也可复活（不撞唯一键）', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      rows: [buildFriendship({ status: 'pending', deleted: 1 })],
    });
    prisma.friendship.update.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 50n },
      data: {
        requesterId: 1n,
        addresseeId: 2n,
        status: 'pending',
        handledAt: null,
        deleted: 0,
      },
    });
  });

  /**
   * 回归（真库集成测试发现的）：唯一键 `uk_friendship(requester, addressee)` **有方向**，
   * 所以 A→B 与 B→A 是两个不同的键。若不双向查，A 申请过 B 之后 B 再申请 A
   * 会插第二行，产生「一对用户两行」的脏数据。
   *
   * 故：两人之间已有行时必须**复用并翻转方向**，并物理删除多余的重复行。
   */
  it('对方之前申请过我：复用那一行并翻转方向，不插第二行', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      rows: [
        buildFriendship({
          requesterId: 2n,
          addresseeId: 1n,
          status: 'rejected',
        }),
      ],
    });
    prisma.friendship.update.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 50n },
      data: {
        requesterId: 1n,
        addresseeId: 2n,
        status: 'pending',
        handledAt: null,
        deleted: 0,
      },
    });
  });

  it('两人之间存在重复行：物理删除多余行，只留一行', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    stubFriendshipLookup(prisma, {
      rows: [
        buildFriendship({
          id: 50n,
          requesterId: 1n,
          addresseeId: 2n,
          status: 'rejected',
        }),
        buildFriendship({
          id: 51n,
          requesterId: 2n,
          addresseeId: 1n,
          status: 'rejected',
        }),
      ],
    });
    prisma.friendship.update.mockResolvedValue({});
    prisma.friendship.deleteMany.mockResolvedValue({ count: 1 });

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).not.toHaveBeenCalled();
    // 多余的那行被物理删除（唯一键不区分 deleted，软删腾不出键）
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [51n] } },
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
