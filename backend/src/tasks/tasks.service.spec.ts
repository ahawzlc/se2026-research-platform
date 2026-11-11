import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

function createService() {
  const tx = {
    task: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
  const prisma = {
    project: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
    },
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
    },
    task: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const activity = {
    recordInTransaction: jest.fn<Promise<void>, [unknown, unknown]>(),
    recordOnce: jest.fn<Promise<boolean>, [unknown, unknown]>(),
    record: jest.fn<Promise<void>, [unknown]>(),
  };
  const service = new TasksService(
    prisma as unknown as PrismaService,
    activity as unknown as ActivityService,
  );
  return { service, prisma, tx, activity };
}

const PROJECT = { id: 3n, teamId: 7n };
const CREATED_TASK = {
  id: 11n,
  projectId: 3n,
  title: '冒烟任务',
  description: '',
  assigneeId: null,
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  sortOrder: 100,
  createdAt: new Date('2026-11-11T12:00:00Z'),
  updatedAt: new Date('2026-11-11T12:00:00Z'),
  project: { name: '项目甲', teamId: 7n },
  assignee: null,
};

/** 打通 requireProject（操作者 user 1 是组 7 成员） */
function mockCallerIsMember(
  prisma: ReturnType<typeof createService>['prisma'],
) {
  prisma.project.findFirst.mockResolvedValue(PROJECT);
  prisma.teamMember.findMany.mockResolvedValue([{ teamId: 7n }]);
}

describe('TasksService.create 的负责人校验', () => {
  it('负责人不是本课题组成员 → 400', async () => {
    const { service, prisma, tx } = createService();
    mockCallerIsMember(prisma);
    // resolveAssignee 内的两次回查：项目 → 组员关系（无）
    prisma.project.findFirst.mockResolvedValue(PROJECT);
    prisma.teamMember.findFirst.mockResolvedValue(null);

    await expect(
      service.create('1', {
        projectId: '3',
        title: '冒烟任务',
        assigneeId: '99',
      }),
    ).rejects.toMatchObject({
      code: 400,
      message: '负责人必须是本课题组成员',
    });
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it('负责人是本课题组成员 → 正常建任务并写埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    mockCallerIsMember(prisma);
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 2n,
      role: 'member',
    });
    tx.task.findFirst.mockResolvedValue(null); // 列内无任务 → sortOrder=100
    tx.task.create.mockResolvedValue({ ...CREATED_TASK, assigneeId: 2n });
    // create 收尾走 detail：requireTask 回查
    prisma.task.findFirst.mockResolvedValue({
      ...CREATED_TASK,
      assigneeId: 2n,
      assignee: { username: 'lisi', nickname: '李四' },
    });

    const result = await service.create('1', {
      projectId: '3',
      title: '冒烟任务',
      assigneeId: '2',
    });

    expect(result.assigneeName).toBe('李四');
    expect(activity.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'task_create', refId: 11n }),
    );
  });

  it('不传负责人 → 待认领，不做组员校验', async () => {
    const { service, prisma, tx } = createService();
    mockCallerIsMember(prisma);
    tx.task.findFirst.mockResolvedValue(null);
    tx.task.create.mockResolvedValue(CREATED_TASK);
    prisma.task.findFirst.mockResolvedValue(CREATED_TASK);

    await service.create('1', { projectId: '3', title: '冒烟任务' });

    expect(prisma.teamMember.findFirst).not.toHaveBeenCalled();
    // 读 mock.calls 显式断言，避免 expect.any 触发 no-unsafe-assignment
    const createCalls = tx.task.create.mock.calls as unknown as Array<
      [{ data: { assigneeId: bigint | null } }]
    >;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].data.assigneeId).toBeNull();
  });
});
