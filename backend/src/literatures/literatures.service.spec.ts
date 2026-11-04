import { LiteraturesService } from './literatures.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

/** 文献行快照，带 include 关系 */
function buildLiterature(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    teamId: 7n,
    projectId: null,
    title: '深度学习综述',
    sourceUrl: 'https://example.com/paper',
    fileId: null,
    readStatus: 'unread',
    uploaderId: 1n,
    createdAt: new Date('2026-11-03T02:00:00Z'),
    updatedAt: new Date('2026-11-03T02:00:00Z'),
    deleted: 0,
    file: null,
    tags: [],
    uploader: { username: 'zhangsan', nickname: '张三' },
    ...overrides,
  };
}

function createService() {
  const tx = {
    literature: { create: jest.fn(), update: jest.fn() },
    literatureTag: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    activityLog: { count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    literature: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    literatureTag: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    project: { findFirst: jest.fn() },
    file: { findFirst: jest.fn() },
    teamMember: {
      findFirst: jest.fn(),
      // resolveTeamId 未传 teamId 时会走 listUserTeamIds → findMany
      findMany: jest.fn().mockResolvedValue([{ teamId: 7n }]),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const activity = {
    recordInTransaction: jest.fn().mockResolvedValue(undefined),
    recordOnce: jest.fn().mockResolvedValue(true),
    revoke: jest.fn().mockResolvedValue(true),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LiteraturesService(
    prisma as unknown as PrismaService,
    activity as unknown as ActivityService,
  );
  return { service, prisma, tx, activity };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('LiteraturesService.create', () => {
  it('附件与外链都为空 → 400', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    await expectBizError(
      service.create('1', { title: '无来源' }),
      400,
      '附件与外链至少提供一个',
    );
  });

  it('创建成功：写 literature + 标签 + literature_upload 埋点，返回字符串 id', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    tx.literature.create.mockResolvedValue(buildLiterature({ id: 9n }));
    tx.literatureTag.findMany.mockResolvedValue([]);
    prisma.literature.findFirst.mockResolvedValue(
      buildLiterature({ id: 9n, tags: [{ tag: '综述' }, { tag: '深度学习' }] }),
    );

    const result = await service.create('1', {
      title: '深度学习综述',
      sourceUrl: 'https://example.com/paper',
      tags: ['综述', '深度学习'],
    });

    expect(result.id).toBe('9');
    expect(result.tags).toEqual(['综述', '深度学习']);
    expect(tx.literature.create).toHaveBeenCalledTimes(1);
    expect(tx.literatureTag.create).toHaveBeenCalledTimes(2);
    expect(activity.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'literature_upload',
        refType: 'literature',
        refId: 9n,
      }),
    );
  });

  it('创建时直接 readStatus=read → 额外写 literature_read', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    tx.literature.create.mockResolvedValue(
      buildLiterature({ readStatus: 'read' }),
    );
    prisma.literature.findFirst.mockResolvedValue(
      buildLiterature({ readStatus: 'read' }),
    );

    await service.create('1', {
      title: '已读文献',
      sourceUrl: 'https://example.com/x',
      readStatus: 'read',
    });

    expect(activity.recordOnce).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'literature_read',
        refType: 'literature',
      }),
    );
  });

  it('单日上限 5 条：第 6 次上传不再写 literature_upload 埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    tx.activityLog.count.mockResolvedValue(5);
    tx.literature.create.mockResolvedValue(buildLiterature());
    prisma.literature.findFirst.mockResolvedValue(buildLiterature());

    await service.create('1', {
      title: '第 6 篇',
      sourceUrl: 'https://example.com/x',
    });

    expect(activity.recordInTransaction).not.toHaveBeenCalled();
  });
});

describe('LiteraturesService.update', () => {
  it('把附件与外链都清空 → 400', async () => {
    const { service, prisma } = createService();
    prisma.literature.findFirst.mockResolvedValue(buildLiterature());
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    await expectBizError(
      service.update('1', '5', { fileId: '', sourceUrl: '' }),
      400,
      '附件与外链至少保留一个',
    );
  });

  it('更新标签：软删旧标签、恢复软删标签、新增标签', async () => {
    const { service, prisma, tx } = createService();
    prisma.literature.findFirst.mockResolvedValue(buildLiterature());
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    tx.literatureTag.findMany.mockResolvedValue([
      { id: 1n, tag: '旧标签', deleted: 0 },
      { id: 2n, tag: '已删标签', deleted: 1 },
    ]);

    await service.update('1', '5', { tags: ['已删标签', '新标签'] });

    expect(tx.literatureTag.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { deleted: 1 },
    });
    expect(tx.literatureTag.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { deleted: 0 },
    });
    expect(tx.literatureTag.create).toHaveBeenCalledWith({
      data: { literatureId: 5n, tag: '新标签' },
    });
  });
});

describe('LiteraturesService.updateReadStatus', () => {
  it('unread → read 写 literature_read', async () => {
    const { service, prisma, tx, activity } = createService();
    // 3 次 findFirst：主方法 requireLiterature / detail 内 requireLiterature / detail 内带 include
    prisma.literature.findFirst
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'unread' }))
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'read' }))
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'read' }));
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });

    await service.updateReadStatus('1', '5', { readStatus: 'read' });

    expect(tx.literature.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { readStatus: 'read' },
    });
    expect(activity.recordOnce).toHaveBeenCalledTimes(1);
  });

  it('状态没变时直接返回，不写库也不写埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.literature.findFirst.mockResolvedValue(
      buildLiterature({ readStatus: 'read' }),
    );
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });

    await service.updateReadStatus('1', '5', { readStatus: 'read' });

    expect(tx.literature.update).not.toHaveBeenCalled();
    expect(activity.recordOnce).not.toHaveBeenCalled();
  });

  it('read → unread 撤销 literature_read', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.literature.findFirst
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'read' }))
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'unread' }))
      .mockResolvedValueOnce(buildLiterature({ readStatus: 'unread' }));
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });

    await service.updateReadStatus('1', '5', { readStatus: 'unread' });

    expect(activity.revoke).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'literature_read',
        refType: 'literature',
        refId: 5n,
      }),
    );
  });
});

describe('LiteraturesService.list', () => {
  it('无课题组返回空列表', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findMany.mockResolvedValue([]);
    const result = await service.list('1', { page: 1, size: 10 });
    expect(result).toEqual({ list: [], total: 0, page: 1, size: 10 });
  });
});

describe('LiteraturesService.remove', () => {
  it('逻辑删除文献，不物理删标签', async () => {
    const { service, prisma } = createService();
    prisma.literature.findFirst.mockResolvedValue(buildLiterature());
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'member',
    });
    prisma.literature.update.mockResolvedValue({});

    await service.remove('1', '5');

    expect(prisma.literature.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { deleted: 1 },
    });
  });
});
