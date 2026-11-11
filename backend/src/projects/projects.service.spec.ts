import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';

function createService() {
  const prisma = {
    project: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
    },
    projectMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
  const service = new ProjectsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('ProjectsService.listMembers（红线 9：项目成员列表须校验团队归属）', () => {
  it('项目不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.listMembers('1', '99')).rejects.toMatchObject({
      code: 404,
      message: '项目不存在',
    });
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('非本项目所属课题组成员 → 403，不返回任何成员信息', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 2n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(service.listMembers('1', '2')).rejects.toMatchObject({
      code: 403,
      message: '不是该课题组的成员，无权访问',
    });
    // 越权请求不允许触达成员数据
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('本课题组成员 → 返回成员列表', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 2n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.projectMember.findMany.mockResolvedValue([
      {
        userId: 1n,
        createdAt: new Date('2026-11-11T12:00:00Z'),
        user: {
          username: 'zhangsan',
          nickname: '张三',
          avatar: '',
          email: 'z@example.com',
        },
      },
    ]);

    const result = await service.listMembers('1', '2');

    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('zhangsan');
    // 读 mock.calls 显式断言，避免 expect.any 触发 no-unsafe-assignment
    const listCalls = prisma.projectMember.findMany.mock
      .calls as unknown as Array<
      [{ where: { projectId: bigint; deleted: number } }]
    >;
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0][0].where).toEqual({ projectId: 2n, deleted: 0 });
  });
});
