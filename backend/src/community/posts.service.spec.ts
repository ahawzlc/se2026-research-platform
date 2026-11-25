import { CommunityPostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';

/** community_post 表一行快照 */
function buildPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    userId: 1n,
    title: '互联网+项目招前端',
    content: '做一个校园二手书平台',
    recruitTotal: 4,
    recruitedCount: 2,
    status: 'recruiting',
    teamId: null,
    createdAt: new Date('2026-11-23T02:00:00Z'),
    updatedAt: new Date('2026-11-23T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

/** 回读时的行：带发布人、绑定课题组与标签关系 */
function withRelations(post: Record<string, unknown>) {
  return {
    ...post,
    author: { id: post.userId, nickname: '张三', avatar: '' },
    team: null,
    tags: [{ tag: { id: 1n, name: '互联网+', category: 'competition' } }],
  };
}

function createService() {
  // prisma 与 tx 共用同一组替身：service 里读写既走 prisma 也可能走事务客户端
  const delegates = {
    communityPost: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    communityPostTag: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    communityTag: { findMany: jest.fn() },
    // 卡 E-2：帖子结构里的 myApplication / pendingCount，以及删除前的待处理申请计数
    teamApplication: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const prisma = {
    ...delegates,
    // 交互式事务：直接把 tx 交给回调执行
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(delegates),
    ),
  };
  const service = new CommunityPostsService(prisma as unknown as PrismaService);
  return { service, prisma, tx: delegates };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('CommunityPostsService.create', () => {
  it('校验标签后同一事务写入帖子与标签关联，返回发布人与 isAuthor', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityTag.findMany.mockResolvedValue([{ id: 1n }, { id: 6n }]);
    tx.communityPost.create.mockResolvedValue({ id: 5n });
    prisma.communityPost.findFirst.mockResolvedValue(
      withRelations(buildPost()),
    );

    const result = await service.create('1', {
      title: '互联网+项目招前端',
      content: '做一个校园二手书平台',
      tagIds: ['1', '6'],
      recruitTotal: 4,
    });

    // 标签只查未删除的字典行
    expect(prisma.communityTag.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1n, 6n] }, deleted: 0 },
      select: { id: true },
    });
    expect(tx.communityPost.create).toHaveBeenCalledWith({
      data: {
        userId: 1n,
        title: '互联网+项目招前端',
        content: '做一个校园二手书平台',
        recruitTotal: 4,
      },
      select: { id: true },
    });
    expect(tx.communityPostTag.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 5n, tagId: 1n },
        { postId: 5n, tagId: 6n },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: '5',
      status: 'recruiting',
      recruitTotal: 4,
      recruitedCount: 2,
      isAuthor: true,
      author: { id: '1', nickname: '张三', avatar: '' },
      tags: [{ id: '1', name: '互联网+', category: 'competition' }],
      team: null,
      createdAt: '2026-11-23 10:00:00',
    });
  });

  it('未传 recruitTotal 默认 1，未传说明存空串', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityTag.findMany.mockResolvedValue([{ id: 1n }]);
    tx.communityPost.create.mockResolvedValue({ id: 5n });
    prisma.communityPost.findFirst.mockResolvedValue(
      withRelations(buildPost({ recruitTotal: 1, content: '' })),
    );

    await service.create('1', { title: '毕业设计组队', tagIds: ['1'] });

    expect(tx.communityPost.create).toHaveBeenCalledWith({
      data: {
        userId: 1n,
        title: '毕业设计组队',
        content: '',
        recruitTotal: 1,
      },
      select: { id: true },
    });
  });

  it('"1" 与 "01" 按数值去重为同一标签，不会撞唯一索引', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityTag.findMany.mockResolvedValue([{ id: 1n }]);
    tx.communityPost.create.mockResolvedValue({ id: 5n });
    prisma.communityPost.findFirst.mockResolvedValue(
      withRelations(buildPost()),
    );

    await service.create('1', { title: '毕业设计组队', tagIds: ['1', '01'] });

    expect(prisma.communityTag.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1n] }, deleted: 0 },
      select: { id: true },
    });
    expect(tx.communityPostTag.createMany).toHaveBeenCalledWith({
      data: [{ postId: 5n, tagId: 1n }],
    });
  });

  it('含字典外或已删除的标签 → 400，不写任何数据', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityTag.findMany.mockResolvedValue([{ id: 1n }]);

    await expectBizError(
      service.create('1', { title: '毕业设计组队', tagIds: ['1', '99'] }),
      400,
      '所选标签不存在',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.communityPost.create).not.toHaveBeenCalled();
  });
});

describe('CommunityPostsService.list', () => {
  it('按标签（命中任一）/ 关键词（标题或正文）/ 状态 / 只看我的 组装查询并分页', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.count.mockResolvedValue(11);
    prisma.communityPost.findMany.mockResolvedValue([
      withRelations(buildPost()),
      withRelations(buildPost({ id: 4n, userId: 2n })),
    ]);

    const result = await service.list('1', {
      page: 2,
      size: 10,
      tags: ['1', '6'],
      q: '前端',
      status: 'recruiting',
      mine: true,
    });

    const where = {
      deleted: 0,
      status: 'recruiting',
      userId: 1n,
      tags: { some: { tagId: { in: [1n, 6n] }, deleted: 0 } },
      OR: [{ title: { contains: '前端' } }, { content: { contains: '前端' } }],
    };
    expect(prisma.communityPost.count).toHaveBeenCalledWith({ where });
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: { id: 'desc' },
        skip: 10,
        take: 10,
      }),
    );
    expect(result).toMatchObject({ total: 11, page: 2, size: 10 });
    // isAuthor 按查看者计算：自己的帖子为 true，他人的为 false
    expect(result.list.map((item) => item.isAuthor)).toEqual([true, false]);
    expect(result.list[1].author.id).toBe('2');
  });

  it('不带筛选时查询条件只有未删除', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.count.mockResolvedValue(0);
    prisma.communityPost.findMany.mockResolvedValue([]);

    const result = await service.list('1', {});

    expect(prisma.communityPost.count).toHaveBeenCalledWith({
      where: { deleted: 0 },
    });
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
    expect(result).toEqual({ list: [], total: 0, page: 1, size: 10 });
  });
});

describe('CommunityPostsService.detail', () => {
  it('不存在 / 已删除 / id 非法 → 一律 404', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(null);
    await expectBizError(service.detail('1', '999'), 404, '帖子不存在');
    await expectBizError(service.detail('1', 'abc'), 404, '帖子不存在');
    // 非法 id 不查库
    expect(prisma.communityPost.findFirst).toHaveBeenCalledTimes(1);
  });

  it('他人帖子可读，isAuthor 为 false', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(
      withRelations(buildPost({ userId: 2n })),
    );

    const result = await service.detail('1', '5');

    expect(prisma.communityPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5n, deleted: 0 } }),
    );
    expect(result.isAuthor).toBe(false);
    expect(result.content).toBe('做一个校园二手书平台');
    // 发布人卡片只含 id / 昵称 / 头像
    expect(Object.keys(result.author).sort()).toEqual([
      'avatar',
      'id',
      'nickname',
    ]);
  });
});

describe('CommunityPostsService.update', () => {
  it('一个字段都不传 → 400', async () => {
    const { service, prisma } = createService();
    await expectBizError(
      service.update('1', '5', {}),
      400,
      '请至少提供要修改的字段',
    );
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled();
  });

  it('非作者 → 403，不发生任何写入', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(buildPost({ userId: 2n }));

    await expectBizError(
      service.update('1', '5', { title: '改一下' }),
      403,
      '仅发帖人可执行此操作',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });

  it('已满员 / 已停止 → 409 不可编辑', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ status: 'full' }),
    );
    await expectBizError(
      service.update('1', '5', { title: '改一下' }),
      409,
      '帖子已停止招募或已满员，不可编辑',
    );
    prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ status: 'closed' }),
    );
    await expectBizError(
      service.update('1', '5', { title: '改一下' }),
      409,
      '帖子已停止招募或已满员，不可编辑',
    );
  });

  it('招募人数不大于已招人数 → 400（至少留 1 个名额）', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ recruitedCount: 3 }),
    );

    await expectBizError(
      service.update('1', '5', { recruitTotal: 3 }),
      400,
      '招募人数需大于已招人数（至少留 1 个名额）',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });

  it('作者编辑：更新字段并整体同步标签（移除 / 恢复 / 新建）', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(buildPost())
      .mockResolvedValueOnce(withRelations(buildPost({ title: '新标题' })));
    prisma.communityTag.findMany.mockResolvedValue([{ id: 2n }, { id: 4n }]);
    tx.communityPostTag.findMany.mockResolvedValue([
      { id: 11n, tagId: 1n, deleted: 0 }, // 仍在但本次移除 → 软删
      { id: 12n, tagId: 2n, deleted: 1 }, // 曾移除、本次恢复 → 复用原行
      { id: 13n, tagId: 3n, deleted: 0 }, // 仍在但本次移除 → 软删
    ]);

    const result = await service.update('1', '5', {
      title: '新标题',
      tagIds: ['2', '4'],
      recruitTotal: 6,
    });

    expect(tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { title: '新标题', recruitTotal: 6 },
    });
    const updates = tx.communityPostTag.update.mock.calls.map(
      ([arg]) => arg as { where: { id: bigint }; data: { deleted: number } },
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        { where: { id: 11n }, data: { deleted: 1 } },
        { where: { id: 13n }, data: { deleted: 1 } },
        { where: { id: 12n }, data: { deleted: 0 } },
      ]),
    );
    expect(tx.communityPostTag.create).toHaveBeenCalledTimes(1);
    expect(tx.communityPostTag.create).toHaveBeenCalledWith({
      data: { postId: 5n, tagId: 4n },
    });
    expect(result.title).toBe('新标题');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('不传 tagIds 时不触碰标签关联', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst
      .mockResolvedValueOnce(buildPost())
      .mockResolvedValueOnce(withRelations(buildPost()));

    await service.update('1', '5', { content: '补充说明' });

    expect(tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { content: '补充说明' },
    });
    expect(prisma.communityTag.findMany).not.toHaveBeenCalled();
    expect(tx.communityPostTag.findMany).not.toHaveBeenCalled();
  });
});

describe('CommunityPostsService.close', () => {
  it('非作者 → 403', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(buildPost({ userId: 2n }));

    await expectBizError(service.close('1', '5'), 403, '仅发帖人可执行此操作');
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });

  it('招募中 / 已满员 均可停止招募', async () => {
    for (const status of ['recruiting', 'full']) {
      const { service, prisma, tx } = createService();
      prisma.communityPost.findFirst
        .mockResolvedValueOnce(buildPost({ status }))
        .mockResolvedValueOnce(withRelations(buildPost({ status: 'closed' })));

      const result = await service.close('1', '5');

      expect(tx.communityPost.update).toHaveBeenCalledWith({
        where: { id: 5n },
        data: { status: 'closed' },
      });
      expect(result.status).toBe('closed');
    }
  });

  it('已停止再停止 → 409', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(
      buildPost({ status: 'closed' }),
    );

    await expectBizError(service.close('1', '5'), 409, '帖子已停止招募');
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });
});

describe('CommunityPostsService.remove', () => {
  it('作者删除 → 逻辑删除（deleted 置 1），不物理删行', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(buildPost());

    await service.remove('1', '5');

    expect(tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { deleted: 1 },
    });
  });

  it('非作者 → 403，不写入', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(buildPost({ userId: 2n }));

    await expectBizError(service.remove('1', '5'), 403, '仅发帖人可执行此操作');
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });

  it('还有待处理申请 → 409 并提示条数，不删除（卡 E-2）', async () => {
    const { service, prisma, tx } = createService();
    prisma.communityPost.findFirst.mockResolvedValue(buildPost());
    prisma.teamApplication.count.mockResolvedValue(2);

    await expectBizError(
      service.remove('1', '5'),
      409,
      '还有 2 条待处理申请，请先处理后再删除',
    );
    // 只数未删除的待处理申请；已通过 / 已拒绝的不阻塞删除
    expect(prisma.teamApplication.count).toHaveBeenCalledWith({
      where: { postId: 5n, status: 'pending', deleted: 0 },
    });
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });
});

describe('CommunityPostsService 与当前用户相关的字段（卡 E-2）', () => {
  /** team_application 表一行快照 */
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

  it('发帖人看到待处理申请数；我的申请按帖子回填', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.count.mockResolvedValue(2);
    prisma.communityPost.findMany.mockResolvedValue([
      withRelations(buildPost()),
      withRelations(buildPost({ id: 4n, userId: 2n })),
    ]);
    // 我（用户 1）对帖子 4 提过申请、已被拒绝；帖子 5 是我发的，有 3 条待处理
    prisma.teamApplication.findMany.mockResolvedValue([
      buildApplication({ id: 40n, postId: 4n, status: 'rejected' }),
    ]);
    prisma.teamApplication.groupBy.mockResolvedValue([
      { postId: 5n, _count: { _all: 3 } },
    ]);

    const result = await service.list('1', {});

    expect(prisma.teamApplication.findMany).toHaveBeenCalledWith({
      where: { userId: 1n, postId: { in: [5n, 4n] }, deleted: 0 },
    });
    // 待处理数只统计我自己发的帖子
    expect(prisma.teamApplication.groupBy).toHaveBeenCalledWith({
      by: ['postId'],
      where: { postId: { in: [5n] }, status: 'pending', deleted: 0 },
      _count: { _all: true },
    });
    expect(result.list[0]).toMatchObject({
      id: '5',
      isAuthor: true,
      myApplication: null,
      pendingCount: 3,
    });
    expect(result.list[1]).toMatchObject({
      id: '4',
      isAuthor: false,
      pendingCount: 0,
      myApplication: {
        id: '40',
        status: 'rejected',
        note: '我会前端',
        createdAt: '2026-11-24 09:00:00',
        handledAt: '',
      },
    });
  });

  it('查看他人帖子且没有发过帖：不发起待处理数统计', async () => {
    const { service, prisma } = createService();
    prisma.communityPost.count.mockResolvedValue(1);
    prisma.communityPost.findMany.mockResolvedValue([
      withRelations(buildPost({ userId: 2n })),
    ]);

    const result = await service.list('1', {});

    expect(prisma.teamApplication.groupBy).not.toHaveBeenCalled();
    expect(result.list[0]).toMatchObject({
      isAuthor: false,
      myApplication: null,
      pendingCount: 0,
    });
  });
});

describe('CommunityPostsService.listTags', () => {
  it('只取未删除标签，先竞赛后课程，id 字符串化', async () => {
    const { service, prisma } = createService();
    prisma.communityTag.findMany.mockResolvedValue([
      { id: 1n, name: '互联网+', category: 'competition', deleted: 0 },
      { id: 6n, name: '软件工程', category: 'course', deleted: 0 },
    ]);

    await expect(service.listTags()).resolves.toEqual([
      { id: '1', name: '互联网+', category: 'competition' },
      { id: '6', name: '软件工程', category: 'course' },
    ]);
    expect(prisma.communityTag.findMany).toHaveBeenCalledWith({
      where: { deleted: 0 },
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    });
  });
});
