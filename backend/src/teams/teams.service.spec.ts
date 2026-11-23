import type { Prisma } from '@prisma/client';
import { TeamsService } from './teams.service';
import { PrismaService } from '../prisma/prisma.service';
import { INVITE_CODE_PATTERN } from './dto/join-team.dto';

/** 单测里的 tx 只是涉及的那几张表的替身，传给 service 时按 Prisma 事务客户端看待 */
const asTx = (tx: unknown): Prisma.TransactionClient =>
  tx as Prisma.TransactionClient;

/** team 表一行快照 */
function buildTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: 7n,
    name: '智能感知课题组',
    description: '',
    inviteCode: 'A3BK7QXR',
    ownerId: 1n,
    createdAt: new Date('2026-10-29T02:00:00Z'),
    updatedAt: new Date('2026-10-29T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

/** team_member 表一行快照（user 关联按需附加） */
function buildMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 100n,
    teamId: 7n,
    userId: 1n,
    role: 'owner',
    createdAt: new Date('2026-10-29T02:00:00Z'),
    updatedAt: new Date('2026-10-29T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

const userBrief = {
  username: 'zhangsan',
  nickname: '张三',
  avatar: '',
  email: 'z@example.com',
  passwordHash: 'SECRET-HASH',
};

function createService() {
  const tx = {
    team: { create: jest.fn() },
    teamMember: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    team: { findFirst: jest.fn() },
    teamMember: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    // 交互式事务：直接把 tx 交给回调执行
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const service = new TeamsService(prisma as unknown as PrismaService);
  return { service, prisma, tx };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('TeamsService.createTeam', () => {
  it('同一事务写入 team 与组长记录，返回符合模式的邀请码', async () => {
    const { service, prisma, tx } = createService();
    tx.team.create.mockResolvedValue(buildTeam());

    const result = await service.createTeam('1', {
      name: '智能感知课题组',
      description: '',
    });

    expect(result.id).toBe('7');
    expect(result.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(result.ownerId).toBe('1');
    // 组长记录与 team 同事务写入
    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 7n, userId: 1n, role: 'owner' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('邀请码撞唯一索引时换码重试，仍失败则报 500', async () => {
    const { service, tx } = createService();
    tx.team.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(buildTeam());

    const recovered = await service.createTeam('1', { name: 'A组' });
    expect(recovered.id).toBe('7');

    tx.team.create.mockReset();
    tx.team.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' });
    await expectBizError(
      service.createTeam('1', { name: 'A组' }),
      500,
      '邀请码生成失败，请重试',
    );
  });
});

describe('TeamsService.createTeamInTransaction（卡 E-2 接缝）', () => {
  it('在调用方事务内写入 team 与组长记录，返回带邀请码的 team 行', async () => {
    const { service, prisma, tx } = createService();
    // 替身把收到的邀请码原样回显，这样才能断言「传给建组的码 = 返回的码」
    tx.team.create.mockImplementation(
      ({ data }: { data: { inviteCode: string } }) =>
        buildTeam({ inviteCode: data.inviteCode }),
    );

    const team = await service.createTeamInTransaction(asTx(tx), 1n, {
      name: '互联网+项目',
      description: '自动创建',
    });

    expect(team.id).toBe(7n);
    expect(team.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(tx.team.create).toHaveBeenCalledWith({
      data: {
        name: '互联网+项目',
        description: '自动创建',
        ownerId: 1n,
        inviteCode: team.inviteCode,
      },
    });
    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 7n, userId: 1n, role: 'owner' },
    });
    // 事务由调用方开启：方法自身不再包一层 $transaction
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('邀请码碰撞时换码重试，三次仍失败报 500', async () => {
    const { service, tx } = createService();
    tx.team.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce(buildTeam());

    const team = await service.createTeamInTransaction(asTx(tx), 1n, {
      name: 'A组',
    });
    expect(team.id).toBe(7n);

    tx.team.create.mockReset();
    tx.team.create.mockRejectedValue({ code: 'P2002' });
    await expectBizError(
      service.createTeamInTransaction(asTx(tx), 1n, { name: 'A组' }),
      500,
      '邀请码生成失败，请重试',
    );
    // 建组失败时不留下组长记录
    expect(tx.teamMember.create).toHaveBeenCalledTimes(1);
  });

  it('其他数据库错误原样抛出，不重试', async () => {
    const { service, tx } = createService();
    tx.team.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.createTeamInTransaction(asTx(tx), 1n, { name: 'A组' }),
    ).rejects.toThrow('connection lost');
    expect(tx.team.create).toHaveBeenCalledTimes(1);
  });
});

describe('TeamsService.ensureMemberInTransaction（卡 E-2 接缝）', () => {
  it('非成员 → 新增 member 行', async () => {
    const { service, tx } = createService();
    tx.teamMember.findFirst.mockResolvedValue(null);

    await service.ensureMemberInTransaction(asTx(tx), 7n, 9n);

    expect(tx.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 7n, userId: 9n, role: 'member' },
    });
  });

  it('曾退出（软删）的成员 → 恢复原行而不是新增', async () => {
    const { service, tx } = createService();
    tx.teamMember.findFirst.mockResolvedValue(
      buildMember({ id: 101n, userId: 9n, deleted: 1 }),
    );

    await service.ensureMemberInTransaction(asTx(tx), 7n, 9n);

    expect(tx.teamMember.update).toHaveBeenCalledWith({
      where: { id: 101n },
      data: { deleted: 0, role: 'member' },
    });
    expect(tx.teamMember.create).not.toHaveBeenCalled();
  });

  it('已是有效成员 → 不写入（申请人可能已凭邀请码先入组）', async () => {
    const { service, tx } = createService();
    tx.teamMember.findFirst.mockResolvedValue(
      buildMember({ id: 101n, userId: 9n, role: 'member' }),
    );

    await service.ensureMemberInTransaction(asTx(tx), 7n, 9n);

    expect(tx.teamMember.create).not.toHaveBeenCalled();
    expect(tx.teamMember.update).not.toHaveBeenCalled();
  });
});

describe('TeamsService.join', () => {
  it('邀请码无效抛 404', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.join('2', { inviteCode: 'ZZZZ9999' }),
      404,
      '邀请码无效',
    );
  });

  it('已是成员抛 409', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(buildTeam());
    prisma.teamMember.findFirst.mockResolvedValue(buildMember({ userId: 2n }));
    await expectBizError(
      service.join('2', { inviteCode: 'A3BK7QXR' }),
      409,
      '已在课题组中',
    );
  });

  it('曾退出（软删）的成员复用原行恢复，而不是新增', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(buildTeam());
    prisma.teamMember.findFirst.mockResolvedValue(
      buildMember({ userId: 2n, deleted: 1 }),
    );

    const result = await service.join('2', { inviteCode: 'A3BK7QXR' });

    expect(prisma.teamMember.update).toHaveBeenCalledWith({
      where: { id: 100n },
      data: { deleted: 0, role: 'member' },
    });
    expect(prisma.teamMember.create).not.toHaveBeenCalled();
    expect(result.role).toBe('member');
    expect(result.id).toBe('7');
  });

  it('新成员正常插入 member 记录', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(buildTeam());
    prisma.teamMember.findFirst.mockResolvedValue(null);

    await service.join('2', { inviteCode: 'A3BK7QXR' });

    expect(prisma.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 7n, userId: 2n, role: 'member' },
    });
  });
});

describe('TeamsService.myTeams', () => {
  it('过滤已删除的组，返回角色与入组时间', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findMany.mockResolvedValue([
      { ...buildMember({ role: 'owner' }), team: buildTeam() },
      {
        ...buildMember({ id: 101n, userId: 1n, teamId: 8n, role: 'member' }),
        team: buildTeam({ id: 8n, deleted: 1 }),
      },
    ]);

    const teams = await service.myTeams('1');

    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: '7',
      role: 'owner',
      joinedAt: '2026-10-29 10:00:00',
    });
  });
});

describe('TeamsService.listMembers', () => {
  it('组不存在抛 404，路径 id 非数字同样 404', async () => {
    const { service } = createService();
    await expectBizError(
      service.listMembers('abc', '1', {}),
      404,
      '课题组不存在',
    );
    await expectBizError(
      service.listMembers('999', '1', {}),
      404,
      '课题组不存在',
    );
  });

  it('非本组成员抛 403', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(buildTeam());
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.listMembers('7', '2', {}),
      403,
      '不是该课题组的成员，无权访问',
    );
  });

  it('返回分页结构，成员条目不含 passwordHash', async () => {
    const { service, prisma } = createService();
    prisma.team.findFirst.mockResolvedValue(buildTeam());
    prisma.teamMember.findFirst.mockResolvedValue(buildMember());
    prisma.teamMember.count.mockResolvedValue(2);
    prisma.teamMember.findMany.mockResolvedValue([
      { ...buildMember(), user: userBrief },
      {
        ...buildMember({ id: 101n, userId: 2n, role: 'member' }),
        user: userBrief,
      },
    ]);

    const result = await service.listMembers('7', '1', { page: 1, size: 10 });

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.list[0]).toEqual({
      userId: '1',
      username: 'zhangsan',
      nickname: '张三',
      avatar: '',
      email: 'z@example.com',
      role: 'owner',
      joinedAt: '2026-10-29 10:00:00',
    });
    expect(JSON.stringify(result)).not.toContain('SECRET-HASH');
  });
});

describe('TeamsService.updateMemberRole', () => {
  function setupOperator(role: string) {
    const ctx = createService();
    ctx.prisma.team.findFirst.mockResolvedValue(buildTeam());
    ctx.prisma.teamMember.findFirst.mockResolvedValue(buildMember({ role }));
    return ctx;
  }

  it('非组长操作抛 403', async () => {
    const { service, prisma } = setupOperator('member');
    prisma.teamMember.findFirst
      .mockResolvedValueOnce(buildMember({ role: 'member' })) // 操作者
      .mockResolvedValueOnce(buildMember({ id: 101n, userId: 2n })); // 目标
    await expectBizError(
      service.updateMemberRole('7', '2', '3', { role: 'admin' }),
      403,
      '仅组长可修改成员角色',
    );
  });

  it('目标不是成员抛 404，目标是组长抛 400', async () => {
    const { service, prisma } = setupOperator('owner');
    prisma.teamMember.findFirst
      .mockResolvedValueOnce(buildMember({ role: 'owner' })) // 操作者
      .mockResolvedValueOnce(null); // 目标不存在
    await expectBizError(
      service.updateMemberRole('7', '1', '99', { role: 'admin' }),
      404,
      '该用户不是课题组成员',
    );

    const { service: s2, prisma: p2 } = setupOperator('owner');
    p2.teamMember.findFirst
      .mockResolvedValueOnce(buildMember({ role: 'owner' })) // 操作者
      .mockResolvedValueOnce(
        buildMember({ id: 100n, userId: 1n, role: 'owner' }),
      ); // 目标=组长本人
    await expectBizError(
      s2.updateMemberRole('7', '1', '1', { role: 'admin' }),
      400,
      '不能修改组长的角色',
    );
  });

  it('组长改成员角色成功，返回更新后的成员条目', async () => {
    const { service, prisma } = setupOperator('owner');
    prisma.teamMember.findFirst
      .mockResolvedValueOnce(buildMember({ role: 'owner' })) // 操作者
      .mockResolvedValueOnce(
        buildMember({ id: 101n, userId: 2n, role: 'member' }),
      ) // 目标
      .mockResolvedValueOnce({
        ...buildMember({ id: 101n, userId: 2n, role: 'admin' }),
        user: userBrief,
      }); // 更新后回读
    prisma.teamMember.update.mockResolvedValue({});

    const result = await service.updateMemberRole('7', '1', '2', {
      role: 'admin',
    });

    expect(prisma.teamMember.update).toHaveBeenCalledWith({
      where: { id: 101n },
      data: { role: 'admin' },
    });
    expect(result.role).toBe('admin');
    expect(result.userId).toBe('2');
  });
});
