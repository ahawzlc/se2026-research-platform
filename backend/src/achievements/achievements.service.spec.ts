import { AchievementsService } from './achievements.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

/** 成果行快照 */
interface AchievementRow {
  id: bigint;
  projectId: bigint;
  type: string;
  title: string;
  description: string | null;
  fileId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  deleted: number;
  project: { name: string };
  file: { originalName: string; url: string | null; size: bigint } | null;
  members: Array<{
    userId: bigint;
    contributionNote: string | null;
    user: {
      username: string;
      nickname: string;
      avatar: string;
      email: string;
    };
  }>;
}

function buildAchievement(
  overrides: Partial<AchievementRow> = {},
): AchievementRow {
  return {
    id: 9n,
    projectId: 3n,
    type: 'paper',
    title: '深度学习综述',
    description: '论文正文',
    fileId: null,
    createdAt: new Date('2026-11-09T02:00:00Z'),
    updatedAt: new Date('2026-11-09T02:00:00Z'),
    deleted: 0,
    project: { name: '智能感知实验平台' },
    file: null,
    members: [],
    ...overrides,
  };
}

function createService() {
  const tx = {
    achievement: {
      create: jest.fn<Promise<AchievementRow>, [unknown]>(),
    },
    achievementMember: {
      createMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
    activityLog: {
      count: jest.fn<Promise<number>, [unknown]>(),
    },
  };
  const prisma = {
    achievement: {
      create: jest.fn<Promise<AchievementRow>, [unknown]>(),
      findFirst: jest.fn<Promise<AchievementRow | null>, [unknown]>(),
      findMany: jest.fn<Promise<AchievementRow[]>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      update: jest.fn<Promise<AchievementRow>, [unknown]>(),
    },
    achievementMember: {
      createMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
    project: {
      findFirst: jest.fn<
        Promise<{ id: bigint; teamId: bigint } | null>,
        [unknown]
      >(),
    },
    file: {
      findFirst: jest.fn<Promise<{ id: bigint } | null>, [unknown]>(),
    },
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<Array<{ userId: bigint }>>, [unknown]>(),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const activity = {
    recordInTransaction: jest.fn<Promise<void>, [unknown, unknown]>(),
    recordOnce: jest.fn<Promise<boolean>, [unknown, unknown]>(),
    revoke: jest.fn<Promise<boolean>, [unknown, unknown]>(),
    record: jest.fn<Promise<void>, [unknown]>(),
  };
  const service = new AchievementsService(
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

describe('AchievementsService.create', () => {
  it('项目不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.create('1', {
        projectId: '99',
        type: 'paper',
        title: '论文',
      }),
      404,
      '项目不存在',
    );
  });

  it('参与人不是本组成员 → 400', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([{ userId: 1n }]);
    await expectBizError(
      service.create('1', {
        projectId: '3',
        type: 'paper',
        title: '论文',
        members: [{ userId: '1' }, { userId: '2' }],
      }),
      400,
      '参与人必须是本课题组成员',
    );
  });

  it('创建成功：写 achievement + 成员 + achievement_submit 埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([
      { userId: 1n },
      { userId: 2n },
    ]);
    tx.achievement.create.mockResolvedValue(buildAchievement());
    prisma.achievement.findFirst.mockResolvedValue(
      buildAchievement({
        members: [
          {
            userId: 1n,
            contributionNote: '负责主体写作',
            user: {
              username: 'user1',
              nickname: '用户1',
              avatar: '',
              email: 'u1@example.com',
            },
          },
        ],
      }),
    );

    const result = await service.create('1', {
      projectId: '3',
      type: 'paper',
      title: '深度学习综述',
      description: '论文正文',
      members: [
        { userId: '1', contributionNote: '负责主体写作' },
        { userId: '2' },
      ],
    });

    expect(result.id).toBe('9');
    expect(result.type).toBe('paper');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].contributionNote).toBe('负责主体写作');

    expect(tx.achievement.create).toHaveBeenCalledWith({
      data: {
        projectId: 3n,
        type: 'paper',
        title: '深度学习综述',
        description: '论文正文',
        fileId: null,
      },
    });
    expect(tx.achievementMember.createMany).toHaveBeenCalledWith({
      data: [
        { achievementId: 9n, userId: 1n, contributionNote: '负责主体写作' },
        { achievementId: 9n, userId: 2n, contributionNote: null },
      ],
    });
    expect(activity.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: '1',
        type: 'achievement_submit',
        refType: 'achievement',
        refId: 9n,
      }),
    );
  });

  it('参与人最多 50 人', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    await expectBizError(
      service.create('1', {
        projectId: '3',
        type: 'paper',
        title: '论文',
        members: Array.from({ length: 51 }, (_, i) => ({
          userId: String(i + 1),
        })),
      }),
      400,
      '参与人最多 50 人',
    );
  });
});

describe('AchievementsService.remove', () => {
  it('逻辑删除成果，不撤销埋点', async () => {
    const { service, prisma, activity } = createService();
    prisma.achievement.findFirst.mockResolvedValue(buildAchievement());
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.achievement.update.mockResolvedValue(
      buildAchievement({ deleted: 1 }),
    );

    await service.remove('1', '9');

    expect(prisma.achievement.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: { deleted: 1 },
    });
    expect(activity.revoke).not.toHaveBeenCalled();
  });
});

describe('AchievementsService.list', () => {
  it('无课题组返回空列表', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findMany.mockResolvedValue([]);
    const result = await service.list('1', { page: 1, size: 10 });
    expect(result).toEqual({ list: [], total: 0, page: 1, size: 10 });
  });
});
