import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateLimitService } from '../auth/rate-limit.service';

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
  // 限流默认放行；需要测限流时单独覆盖 hit 的返回值
  const rateLimit = { hit: jest.fn().mockReturnValue(true) };
  const service = new FriendsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
    rateLimit as unknown as RateLimitService,
  );
  return { service, prisma, notifications, rateLimit };
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

/**
 * 让 user.findFirst 按查询条件分派。
 *
 * createRequest 会查两次 user：
 *   - `where: { publicUid }` → 对方（peer）；
 *   - `where: { id: me }`    → 当前登录用户（拼通知标题用，见缺陷 A1）。
 * 早期版本两个查询都返回同一行，导致通知标题的主语取错。
 */
function stubUserLookup(
  prisma: { user: { findFirst: jest.Mock } },
  rules: {
    /** 当前登录用户（id=1） */
    me?: Record<string, unknown> | null;
    /** 对方（uid 匹配） */
    peer?: Record<string, unknown> | null;
  },
): void {
  prisma.user.findFirst.mockImplementation(
    (args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if (where.publicUid !== undefined) {
        return Promise.resolve(rules.peer ?? null);
      }
      if (where.id !== undefined) {
        return Promise.resolve(rules.me ?? null);
      }
      return Promise.resolve(null);
    },
  );
}

/** 当前登录用户（张三），用于拼通知标题 */
function buildMe(overrides: Record<string, unknown> = {}) {
  return buildUser({
    id: 1n,
    username: 'zhangsan',
    nickname: '张三',
    ...overrides,
  });
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
    stubUserLookup(prisma, {
      peer: buildUser(),
      me: buildMe(),
    });
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

  /**
   * 回归（缺陷 A1）：通知标题的主语必须是**发起人**。
   *
   * 早期版本用了 peer（对方）的昵称，导致收件人看到
   * 「李四 请求加你为好友」——而收件人自己就是李四。
   */
  it('通知标题用发起人的称呼，不是对方的（缺陷 A1）', async () => {
    const { service, prisma, notifications } = createService();
    stubUserLookup(prisma, {
      peer: buildUser({ nickname: '李四' }),
      me: buildMe({ nickname: '张三' }),
    });
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });
    notifications.push.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'friend_request',
        title: '张三 请求加你为好友',
        toUserId: '2',
      }),
    );
  });

  it('发起人没设昵称时，通知标题回退到登录名', async () => {
    const { service, prisma, notifications } = createService();
    stubUserLookup(prisma, {
      peer: buildUser({ nickname: '李四' }),
      me: buildMe({ nickname: '', username: 'zhangsan' }),
    });
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });
    notifications.push.mockResolvedValue({});

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'zhangsan 请求加你为好友' }),
    );
  });

  it('UID 不存在 → 404', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: null, me: buildMe() });
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000999' }),
      404,
      '该 UID 不存在',
    );
  });

  it('不能加自己为好友 → 400', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser({ id: 1n }), me: buildMe() });
    await expectBizError(
      service.createRequest('1', { uid: 'U0000000001' }),
      400,
      '不能添加自己为好友',
    );
  });

  it('已是好友 → 409', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
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

  /**
   * 防骚扰 1（评审意见 D3）：被拒冷却期内不能再向同一人申请。
   *
   * 拒绝是静默的（不给拒绝方发通知），若不设冷却，
   * 「被拒 → 立刻再发」就成了不受打扰的骚扰通道。
   */
  it('被拒冷却期内再次申请 → 409（并说明剩余天数）', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    // 一小时前被拒。
    // 注意 findFirst 要按 where 分派：areFriends 查的是 status='accepted'，
    // 冷却期查的是 status='rejected'，两者必须返回不同的行。
    prisma.friendship.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          args.where.status === 'accepted'
            ? null
            : buildFriendship({
                status: 'rejected',
                requesterId: 1n,
                addresseeId: 2n,
                handledAt: new Date(Date.now() - 60 * 60 * 1000),
              }),
        ),
    );

    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '对方刚刚拒绝过你的好友申请，3 天内不能再发起申请',
    );
    expect(prisma.friendship.create).not.toHaveBeenCalled();
    expect(prisma.friendship.update).not.toHaveBeenCalled();
  });

  it('冷却期已过 → 可以再次申请', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    // 4 天前被拒（冷却期 3 天）
    prisma.friendship.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          args.where.status === 'accepted'
            ? null
            : buildFriendship({
                status: 'rejected',
                requesterId: 1n,
                addresseeId: 2n,
                handledAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
              }),
        ),
    );
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).toHaveBeenCalled();
  });

  /**
   * 被拒冷却期的天数提示（评审意见 R2）：
   * `handled_at` 落库时按秒四舍五入，可能比当前时间还晚不到 1 秒，
   * `elapsed` 成了负数，向上取整就会多算一天（提示 4 天而不是 3 天）。
   * 这里把 handledAt 设成「未来 0.5 秒」来复现，提示必须是 3 天。
   */
  it('被拒时间因秒级舍入略晚于当前时间 → 提示仍是 3 天而不是 4 天', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    // handledAt 比「现在」晚 500 毫秒 —— 模拟 MySQL 8 的秒级四舍五入
    prisma.friendship.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          args.where.status === 'accepted'
            ? null
            : buildFriendship({
                status: 'rejected',
                requesterId: 1n,
                addresseeId: 2n,
                handledAt: new Date(Date.now() + 500),
              }),
        ),
    );

    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '对方刚刚拒绝过你的好友申请，3 天内不能再发起申请',
    );
  });

  /**
   * 撤回不进冷却期（评审意见 R2，牵头人 2026-11-25 定）：
   * 撤回是申请方主动撤的，对方并未拒绝，撤回后应能立即重新申请。
   */
  it('撤回过的关系行不算「被拒」→ 不触发冷却期', async () => {
    const { service, prisma } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    // 撤回后该行是 deleted=1 + status=pending，
    // 冷却期查询（where.status === 'rejected'）不应命中它
    prisma.friendship.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          args.where.status === 'accepted'
            ? null
            : args.where.status === 'rejected'
              ? null // 没有「被拒」的行 → 不进冷却期
              : buildFriendship({
                  status: 'pending',
                  requesterId: 1n,
                  addresseeId: 2n,
                  deleted: 1,
                }),
        ),
    );
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(prisma.friendship.create).toHaveBeenCalled();
  });

  /**
   * 防骚扰 2（评审意见 D3）：每人每天的申请次数上限。
   */
  it('超出每日申请上限 → 400 并说明上限', async () => {
    const { service, prisma, rateLimit } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    prisma.friendship.findFirst.mockResolvedValue(null);
    // 无历史关系行（计数在查重之后，需要先走到限流那一步）
    stubFriendshipLookup(prisma, {});
    rateLimit.hit.mockReturnValue(false);

    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      400,
      '今日好友申请次数已达上限（20 次），请明天再试',
    );
    expect(prisma.friendship.create).not.toHaveBeenCalled();
  });

  /**
   * 计数时机（评审建议项）：
   * 对同一个等待中的人反复点「申请」，每次 409 都不该扣当天的额度——
   * 否则 18 次重复申请就把 20 次额度用光，正常用户反而申请不了新好友。
   */
  it('重复申请（已有 pending）→ 409 且不消耗每日额度', async () => {
    const { service, prisma, rateLimit } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    prisma.friendship.findFirst.mockResolvedValue(null);
    stubFriendshipLookup(prisma, {
      rows: [
        buildFriendship({ status: 'pending', requesterId: 1n, addresseeId: 2n }),
      ],
    });
    rateLimit.hit.mockReturnValue(true);

    await expectBizError(
      service.createRequest('1', { uid: 'U0000000002' }),
      409,
      '好友申请已发出，等待对方处理',
    );
    // 关键断言：限流没有被触发
    expect(rateLimit.hit).not.toHaveBeenCalled();
  });

  it('限流按「发起人」维度计数', async () => {
    const { service, prisma, rateLimit } = createService();
    stubUserLookup(prisma, { peer: buildUser(), me: buildMe() });
    prisma.friendship.findFirst.mockResolvedValue(null);
    stubFriendshipLookup(prisma, {});
    prisma.friendship.create.mockResolvedValue({ id: 50n });

    await service.createRequest('1', { uid: 'U0000000002' });

    expect(rateLimit.hit).toHaveBeenCalledWith(
      'friend-request:1',
      20,
      24 * 60 * 60 * 1000,
    );
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

  /**
   * 回归（缺陷 A1）：同意通知的主语必须是**同意人**（当前登录用户）。
   *
   * 早期版本用了 requester（申请方）的昵称，导致申请方看到
   * 「张三 已同意你的好友申请」——而申请方自己就是张三。
   */
  it('同意通知标题用同意人的称呼，不是申请方的（缺陷 A1）', async () => {
    const { service, prisma, notifications } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({
        status: 'pending',
        addresseeId: 2n,
        requester: buildUser({ id: 1n, nickname: '张三' }),
      }),
    );
    prisma.friendship.update.mockResolvedValue({});
    notifications.push.mockResolvedValue({});
    // 当前登录用户是 id=2（点「同意」的人），昵称「李四」
    stubUserLookup(prisma, {
      me: buildUser({ id: 2n, username: 'lisi', nickname: '李四' }),
    });

    await service.acceptRequest('2', '50');

    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'friend_accepted',
        title: '李四 已同意你的好友申请',
        toUserId: '1',
      }),
    );
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

describe('FriendsService.withdrawRequest', () => {
  it('撤回：逻辑删除该行，不发通知（评审意见 R2：撤回不进冷却期）', async () => {
    const { service, prisma, notifications } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ status: 'pending', requesterId: 1n, addresseeId: 2n }),
    );
    prisma.friendship.update.mockResolvedValue({});

    await service.withdrawRequest('1', '50');

    const updateCalls = prisma.friendship.update.mock.calls as unknown as Array<
      [{ data: { deleted: number; status?: string; handledAt?: Date } }]
    >;
    // 撤回是逻辑删除：deleted 置 1，状态保持 pending（不转 rejected）
    expect(updateCalls[0][0].data.deleted).toBe(1);
    // 不转 rejected —— 否则会被「被拒冷却期」误判为对方拒绝过
    expect(updateCalls[0][0].data.status).toBeUndefined();
    expect(updateCalls[0][0].data.handledAt).toBeUndefined();
    expect(notifications.push).not.toHaveBeenCalled();
  });

  it('不能撤回别人的申请 → 404', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ status: 'pending', requesterId: 2n, addresseeId: 1n }),
    );
    await expectBizError(
      service.withdrawRequest('1', '50'),
      404,
      '好友申请不存在或不是你发出的',
    );
    expect(prisma.friendship.update).not.toHaveBeenCalled();
  });

  it('申请已被处理 → 409（无法撤回）', async () => {
    const { service, prisma } = createService();
    prisma.friendship.findFirst.mockResolvedValue(
      buildFriendship({ status: 'accepted', requesterId: 1n, addresseeId: 2n }),
    );
    await expectBizError(
      service.withdrawRequest('1', '50'),
      409,
      '该申请已被处理，无法撤回',
    );
    expect(prisma.friendship.update).not.toHaveBeenCalled();
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
