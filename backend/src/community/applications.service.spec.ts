import { CommunityApplicationsService } from './applications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { NotificationsService } from '../notifications/notifications.service';

/** community_post 表一行快照 */
function buildPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    userId: 1n,
    title: '互联网+项目招前端',
    content: '做一个校园二手书平台',
    recruitTotal: 2,
    recruitedCount: 0,
    status: 'recruiting',
    teamId: null,
    createdAt: new Date('2026-11-23T02:00:00Z'),
    updatedAt: new Date('2026-11-23T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

/** team_application 表一行快照：申请人用户 9，帖子 5 */
function buildApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 31n,
    postId: 5n,
    userId: 9n,
    note: '我会前端',
    status: 'pending',
    handledBy: null,
    handledAt: null,
    createdAt: new Date('2026-11-24T01:00:00Z'),
    updatedAt: new Date('2026-11-24T01:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

const applicant = { id: 9n, nickname: '鲍勃', avatar: '' };
const operator = { nickname: '爱丽丝' };

/** 回读到的「刚创建、待处理」的申请 */
const pendingRow = () => ({ ...buildApplication(), applicant });
/** 回读到的「已处理」的申请 */
function handledRow(overrides: Record<string, unknown> = {}) {
  return {
    ...buildApplication({
      status: 'approved',
      handledBy: 1n,
      handledAt: new Date('2026-11-24T02:00:00Z'),
    }),
    applicant,
    ...overrides,
  };
}
/** 回读到的「当前帖子」（带已绑定的课题组） */
function currentPost(overrides: Record<string, unknown> = {}) {
  return {
    ...buildPost({ recruitedCount: 1, teamId: 7n }),
    team: { id: 7n, name: '互联网+项目招前端' },
    ...overrides,
  };
}

/** 事务内「占位 / 条件更新」的调用参数；给替身标上签名，断言时才能读到类型化的实参 */
interface UpdateManyArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}
/**
 * @types/jest 的 jest.fn 泛型：<返回类型, 参数元组>；
 * 返回类型写成 Promise，mockResolvedValue 才有对应的类型（它会拆开 Promise）。
 */
const updateMany = () =>
  jest.fn<Promise<{ count: number }>, [UpdateManyArgs]>();

function createService() {
  const tx = {
    teamApplication: {
      create: jest.fn(),
      updateMany: updateMany(),
      findFirstOrThrow: jest.fn(),
    },
    communityPost: {
      update: jest.fn(),
      updateMany: updateMany(),
      findFirstOrThrow: jest.fn(),
    },
  };
  const prisma = {
    teamApplication: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    communityPost: { findFirst: jest.fn() },
    user: { findFirstOrThrow: jest.fn() },
    // 交互式事务：直接把 tx 交给回调执行
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const teams = {
    createTeamInTransaction: jest.fn(),
    ensureMemberInTransaction: jest.fn(),
  };
  const notifications = { pushInTransaction: jest.fn() };
  const service = new CommunityApplicationsService(
    prisma as unknown as PrismaService,
    teams as unknown as TeamsService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, tx, teams, notifications };
}

type ServiceContext = ReturnType<typeof createService>;

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

/** 装配一次「发帖人 1 审批帖子 5 上的申请 31」的前置读取与默认成功路径 */
function setupHandle(
  ctx: ServiceContext,
  options: {
    post?: Record<string, unknown>;
    application?: Record<string, unknown>;
  } = {},
) {
  ctx.prisma.teamApplication.findFirst.mockResolvedValue(
    buildApplication(options.application),
  );
  ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost(options.post));
  ctx.prisma.user.findFirstOrThrow.mockResolvedValue(operator);
  // 事务内：占位成功、名额 +1、回读已处理申请与带课题组的帖子
  ctx.tx.teamApplication.updateMany.mockResolvedValue({ count: 1 });
  ctx.tx.communityPost.updateMany.mockResolvedValue({ count: 1 });
  ctx.tx.teamApplication.findFirstOrThrow.mockResolvedValue(handledRow());
  ctx.tx.communityPost.findFirstOrThrow.mockResolvedValue(currentPost());
}

/** 装配一次「用户 9 申请帖子 5」的前置读取 */
function setupApply(ctx: ServiceContext) {
  ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost());
  ctx.prisma.teamApplication.findFirst.mockResolvedValue(null);
  ctx.prisma.user.findFirstOrThrow.mockResolvedValue({ nickname: '鲍勃' });
  ctx.tx.teamApplication.create.mockResolvedValue({ id: 31n });
  ctx.prisma.teamApplication.findFirstOrThrow.mockResolvedValue(pendingRow());
}

describe('CommunityApplicationsService.apply', () => {
  it('同一事务写入申请并通知发帖人，返回申请条目', async () => {
    const ctx = createService();
    setupApply(ctx);

    const result = await ctx.service.apply('9', '5', { note: '我会前端' });

    expect(ctx.tx.teamApplication.create).toHaveBeenCalledWith({
      data: { postId: 5n, userId: 9n, note: '我会前端' },
      select: { id: true },
    });
    expect(ctx.notifications.pushInTransaction).toHaveBeenCalledWith(ctx.tx, {
      toUserId: 1n,
      type: 'team_apply',
      title: '鲍勃 申请加入你的帖子《互联网+项目招前端》',
      refType: 'community_post',
      refId: 5n,
    });
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: '31',
      postId: '5',
      status: 'pending',
      note: '我会前端',
      createdAt: '2026-11-24 09:00:00',
      handledAt: '',
      applicant: { id: '9', nickname: '鲍勃', avatar: '' },
    });
  });

  it('申请说明可省略，落库存空串', async () => {
    const ctx = createService();
    setupApply(ctx);

    await ctx.service.apply('9', '5', {});

    expect(ctx.tx.teamApplication.create).toHaveBeenCalledWith({
      data: { postId: 5n, userId: 9n, note: '' },
      select: { id: true },
    });
  });

  it('帖子不存在 → 404；申请自己的帖子 → 400', async () => {
    const ctx = createService();
    ctx.prisma.communityPost.findFirst.mockResolvedValue(null);
    await expectBizError(ctx.service.apply('9', '999', {}), 404, '帖子不存在');

    ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost());
    await expectBizError(
      ctx.service.apply('1', '5', {}),
      400,
      '不能申请自己的帖子',
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('已满员 / 已停止 → 409', async () => {
    const ctx = createService();
    ctx.prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ status: 'full' }),
    );
    await expectBizError(ctx.service.apply('9', '5', {}), 409, '帖子已满员');

    ctx.prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ status: 'closed' }),
    );
    await expectBizError(
      ctx.service.apply('9', '5', {}),
      409,
      '帖子已停止招募',
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('已有申请（任何状态）→ 409，不产生第二条', async () => {
    const cases: Array<[string, string]> = [
      ['pending', '已申请，请等待发帖人处理'],
      ['approved', '你已通过申请加入该团队，无需再次申请'],
      ['rejected', '申请已被拒绝，不能再次申请'],
    ];
    for (const [status, message] of cases) {
      const ctx = createService();
      ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost());
      ctx.prisma.teamApplication.findFirst.mockResolvedValue({ status });

      await expectBizError(ctx.service.apply('9', '5', {}), 409, message);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
      expect(ctx.tx.teamApplication.create).not.toHaveBeenCalled();
    }
  });

  it('并发重复申请撞唯一键 → 409', async () => {
    const ctx = createService();
    setupApply(ctx);
    ctx.tx.teamApplication.create.mockRejectedValue({ code: 'P2002' });

    await expectBizError(
      ctx.service.apply('9', '5', {}),
      409,
      '已申请，请等待发帖人处理',
    );
    // 申请没写成，通知也不发
    expect(ctx.notifications.pushInTransaction).not.toHaveBeenCalled();
  });
});

describe('CommunityApplicationsService.list', () => {
  it('仅发帖人可看：非发帖人 403', async () => {
    const ctx = createService();
    ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost());

    await expectBizError(
      ctx.service.list('2', '5', {}),
      403,
      '仅发帖人可执行此操作',
    );
    expect(ctx.prisma.teamApplication.findMany).not.toHaveBeenCalled();
  });

  it('限定本帖、按状态过滤、id 倒序分页', async () => {
    const ctx = createService();
    ctx.prisma.communityPost.findFirst.mockResolvedValue(buildPost());
    ctx.prisma.teamApplication.count.mockResolvedValue(3);
    ctx.prisma.teamApplication.findMany.mockResolvedValue([handledRow()]);

    const result = await ctx.service.list('1', '5', {
      status: 'approved',
      page: 2,
      size: 10,
    });

    expect(ctx.prisma.teamApplication.count).toHaveBeenCalledWith({
      where: { postId: 5n, deleted: 0, status: 'approved' },
    });
    expect(ctx.prisma.teamApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'desc' }, skip: 10, take: 10 }),
    );
    expect(result).toMatchObject({ total: 3, page: 2, size: 10 });
    expect(result.list[0]).toMatchObject({ id: '31', status: 'approved' });
  });
});

describe('CommunityApplicationsService.approve', () => {
  it('非发帖人 → 403，不进事务', async () => {
    const ctx = createService();
    setupHandle(ctx);
    ctx.prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ userId: 2n }),
    );

    await expectBizError(
      ctx.service.approve('1', '31'),
      403,
      '仅发帖人可执行此操作',
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.tx.teamApplication.updateMany).not.toHaveBeenCalled();
    expect(ctx.teams.createTeamInTransaction).not.toHaveBeenCalled();
  });

  it('申请不存在 → 404；已处理 → 409', async () => {
    const missing = createService();
    missing.prisma.teamApplication.findFirst.mockResolvedValue(null);
    await expectBizError(missing.service.approve('1', '31'), 404, '申请不存在');
    await expectBizError(
      missing.service.approve('1', 'abc'),
      404,
      '申请不存在',
    );

    const done = createService();
    setupHandle(done, { application: { status: 'rejected' } });
    await expectBizError(done.service.approve('1', '31'), 409, '该申请已处理');
    expect(done.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('帖子已满员 → 409，不进事务', async () => {
    const ctx = createService();
    setupHandle(ctx, { post: { status: 'full' } });

    await expectBizError(
      ctx.service.approve('1', '31'),
      409,
      '帖子已满员，无法再通过申请',
    );
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('首次通过：占位 → 名额 +1 → 自动建组并绑定 → 申请人入组 → 通知，返回邀请码', async () => {
    const ctx = createService();
    setupHandle(ctx);
    ctx.teams.createTeamInTransaction.mockResolvedValue({
      id: 7n,
      inviteCode: 'A3BK7QXR',
    });

    const result = await ctx.service.approve('1', '31');

    // 1) 申请原子占位：只有仍是 pending 的才会被改走
    const claim = ctx.tx.teamApplication.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 31n, status: 'pending', deleted: 0 });
    expect(claim.data).toMatchObject({ status: 'approved', handledBy: 1n });
    expect(claim.data.handledAt).toBeInstanceOf(Date);
    // 2) 名额条件更新：仍有名额才 +1
    expect(ctx.tx.communityPost.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 5n,
        deleted: 0,
        status: { in: ['recruiting', 'closed'] },
        recruitedCount: { lt: 2 },
      },
      data: { recruitedCount: { increment: 1 } },
    });
    // 3) 自动建组：名称 = 帖子标题、发帖人为组长；随后把帖子绑定到该组
    expect(ctx.teams.createTeamInTransaction).toHaveBeenCalledWith(ctx.tx, 1n, {
      name: '互联网+项目招前端',
      description: '由组队广场招募帖自动创建',
    });
    expect(ctx.tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { teamId: 7n },
    });
    // 4) 申请人入组
    expect(ctx.teams.ensureMemberInTransaction).toHaveBeenCalledWith(
      ctx.tx,
      7n,
      9n,
    );
    // 5) 未招满（1 < 2）不转「已满员」：帖子只被更新了一次（绑定课题组）
    expect(ctx.tx.communityPost.update).toHaveBeenCalledTimes(1);
    // 6) 通知申请人
    expect(ctx.notifications.pushInTransaction).toHaveBeenCalledWith(ctx.tx, {
      toUserId: 9n,
      type: 'team_apply_approved',
      title: '爱丽丝 通过了你加入《互联网+项目招前端》的申请',
      refType: 'community_post',
      refId: 5n,
    });
    // 步骤顺序：占位 → 名额 → 建组 → 入组 → 通知，全部在同一个事务里
    const order = [
      ctx.tx.teamApplication.updateMany,
      ctx.tx.communityPost.updateMany,
      ctx.teams.createTeamInTransaction,
      ctx.teams.ensureMemberInTransaction,
      ctx.notifications.pushInTransaction,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(result.application).toEqual({
      id: '31',
      postId: '5',
      status: 'approved',
      note: '我会前端',
      createdAt: '2026-11-24 09:00:00',
      handledAt: '2026-11-24 10:00:00',
      applicant: { id: '9', nickname: '鲍勃', avatar: '' },
    });
    expect(result.post).toEqual({
      recruitedCount: 1,
      recruitTotal: 2,
      status: 'recruiting',
      team: { id: '7', name: '互联网+项目招前端' },
    });
    expect(result.inviteCode).toBe('A3BK7QXR');
  });

  it('招满：进度到达招募人数后转「已满员」', async () => {
    const ctx = createService();
    setupHandle(ctx, { post: { recruitedCount: 1 } });
    ctx.teams.createTeamInTransaction.mockResolvedValue({
      id: 7n,
      inviteCode: 'A3BK7QXR',
    });
    ctx.tx.communityPost.findFirstOrThrow
      .mockResolvedValueOnce(currentPost({ recruitedCount: 2 }))
      .mockResolvedValueOnce(
        currentPost({ recruitedCount: 2, status: 'full' }),
      );

    const result = await ctx.service.approve('1', '31');

    expect(ctx.tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { status: 'full' },
    });
    expect(result.post.status).toBe('full');
    expect(result.post.recruitedCount).toBe(2);
  });

  it('已有课题组：复用而不重建，响应不带邀请码', async () => {
    const ctx = createService();
    setupHandle(ctx, { post: { teamId: 7n } });

    const result = await ctx.service.approve('1', '31');

    expect(ctx.teams.createTeamInTransaction).not.toHaveBeenCalled();
    expect(ctx.teams.ensureMemberInTransaction).toHaveBeenCalledWith(
      ctx.tx,
      7n,
      9n,
    );
    expect(ctx.tx.communityPost.update).not.toHaveBeenCalled();
    expect(result.inviteCode).toBeUndefined();
    expect(result.post.team).toEqual({ id: '7', name: '互联网+项目招前端' });
  });

  it('已停止的帖子仍可通过存量申请，状态保持「已停止」', async () => {
    const ctx = createService();
    setupHandle(ctx, { post: { status: 'closed', recruitTotal: 1 } });
    ctx.teams.createTeamInTransaction.mockResolvedValue({
      id: 7n,
      inviteCode: 'A3BK7QXR',
    });
    ctx.tx.communityPost.findFirstOrThrow
      .mockResolvedValueOnce(
        currentPost({ status: 'closed', recruitedCount: 1 }),
      )
      .mockResolvedValueOnce(
        currentPost({
          status: 'closed',
          recruitedCount: 1,
          recruitTotal: 1,
        }),
      );

    const result = await ctx.service.approve('1', '31');

    // 名额已满但不从「已停止」改成「已满员」：帖子只被更新了一次（绑定课题组）
    expect(ctx.tx.communityPost.update).toHaveBeenCalledTimes(1);
    expect(result.post.status).toBe('closed');
  });

  it('名额被并发占满 → 409，不建组、不入组、不通知', async () => {
    const ctx = createService();
    setupHandle(ctx);
    ctx.tx.communityPost.updateMany.mockResolvedValue({ count: 0 });

    await expectBizError(
      ctx.service.approve('1', '31'),
      409,
      '帖子已满员，无法再通过申请',
    );
    expect(ctx.teams.createTeamInTransaction).not.toHaveBeenCalled();
    expect(ctx.teams.ensureMemberInTransaction).not.toHaveBeenCalled();
    expect(ctx.notifications.pushInTransaction).not.toHaveBeenCalled();
  });

  it('并发重复审批：占位失败 → 409，后续步骤全部不执行', async () => {
    const ctx = createService();
    setupHandle(ctx);
    ctx.tx.teamApplication.updateMany.mockResolvedValue({ count: 0 });

    await expectBizError(ctx.service.approve('1', '31'), 409, '该申请已处理');
    expect(ctx.tx.communityPost.updateMany).not.toHaveBeenCalled();
    expect(ctx.teams.createTeamInTransaction).not.toHaveBeenCalled();
    expect(ctx.teams.ensureMemberInTransaction).not.toHaveBeenCalled();
    expect(ctx.notifications.pushInTransaction).not.toHaveBeenCalled();
  });
});

describe('CommunityApplicationsService.reject', () => {
  it('记录结果并通知申请人；不动帖子、不建组', async () => {
    const ctx = createService();
    setupHandle(ctx);
    ctx.tx.teamApplication.findFirstOrThrow.mockResolvedValue(
      handledRow({ status: 'rejected' }),
    );
    ctx.tx.communityPost.findFirstOrThrow.mockResolvedValue(
      currentPost({ recruitedCount: 0, teamId: null, team: null }),
    );

    const result = await ctx.service.reject('1', '31');

    const claim = ctx.tx.teamApplication.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 31n, status: 'pending', deleted: 0 });
    expect(claim.data).toMatchObject({ status: 'rejected', handledBy: 1n });
    expect(ctx.notifications.pushInTransaction).toHaveBeenCalledWith(ctx.tx, {
      toUserId: 9n,
      type: 'team_apply_rejected',
      title: '爱丽丝 拒绝了你加入《互联网+项目招前端》的申请',
      refType: 'community_post',
      refId: 5n,
    });
    expect(ctx.tx.communityPost.updateMany).not.toHaveBeenCalled();
    expect(ctx.teams.createTeamInTransaction).not.toHaveBeenCalled();
    expect(ctx.teams.ensureMemberInTransaction).not.toHaveBeenCalled();
    expect(result.application.status).toBe('rejected');
    expect(result.post).toEqual({
      recruitedCount: 0,
      recruitTotal: 2,
      status: 'recruiting',
      team: null,
    });
  });

  it('非发帖人 → 403；已处理 → 409', async () => {
    const other = createService();
    setupHandle(other);
    await expectBizError(
      other.service.reject('2', '31'),
      403,
      '仅发帖人可执行此操作',
    );
    expect(other.prisma.$transaction).not.toHaveBeenCalled();

    const done = createService();
    setupHandle(done, { application: { status: 'approved' } });
    await expectBizError(done.service.reject('1', '31'), 409, '该申请已处理');
  });
});
