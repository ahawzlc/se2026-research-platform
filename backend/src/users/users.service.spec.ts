import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

/** user 表一行快照 */
function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    username: 'zhangsan',
    nickname: '张三',
    avatar: '',
    email: 'zhang@example.com',
    passwordHash: 'HASH',
    publicUid: 'U0000000001',
    bio: '你好',
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
    },
  };
  const service = new UsersService(prisma as unknown as PrismaService);
  return { service, prisma };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('UsersService.updateMyProfile', () => {
  it('只改传入的字段（不改 UID / 用户名）', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    prisma.user.update.mockResolvedValue(
      buildUser({ nickname: '新昵称', bio: '新简介' }),
    );

    const result = await service.updateMyProfile('1', {
      nickname: '新昵称',
      bio: '新简介',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { nickname: '新昵称', bio: '新简介' },
    });
    expect(result.nickname).toBe('新昵称');
  });

  it('一个字段都没传 → 400', async () => {
    const { service, prisma } = createService();
    await expectBizError(
      service.updateMyProfile('1', {}),
      400,
      '请至少提供要修改的字段',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('可见范围被透传', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    prisma.user.update.mockResolvedValue(
      buildUser({ profileVisibility: 'private' }),
    );

    const result = await service.updateMyProfile('1', {
      profileVisibility: 'private',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { profileVisibility: 'private' },
    });
    expect(result.profileVisibility).toBe('private');
  });
});

describe('UsersService 可见范围判定', () => {
  it('public：任何登录用户可看', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'public' }),
    );
    prisma.friendship.findMany.mockResolvedValue([]);

    const result = await service.profileById('1', '2');
    expect(result.id).toBe('2');
    expect(result.relation).toBe('none');
  });

  it('private：非本人看不到 → 403', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'private' }),
    );
    await expectBizError(
      service.profileById('1', '2'),
      403,
      '该用户的主页不可见',
    );
  });

  it('friends：非好友看不到 → 403', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'friends' }),
    );
    prisma.friendship.findFirst.mockResolvedValue(null); // 非好友

    await expectBizError(
      service.profileById('1', '2'),
      403,
      '该用户的主页仅好友可见',
    );
  });

  it('friends：是好友则可看', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'friends' }),
    );
    prisma.friendship.findFirst.mockResolvedValue({ id: 50n }); // accepted
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 1n, addresseeId: 2n, status: 'accepted' },
    ]);

    const result = await service.profileById('1', '2');
    expect(result.id).toBe('2');
    expect(result.relation).toBe('friends');
  });

  it('private：本人可看自己', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 1n, profileVisibility: 'private' }),
    );
    prisma.friendship.findMany.mockResolvedValue([]);

    const result = await service.myProfile('1');
    expect(result.isSelf).toBe(true);
  });
});

describe('UsersService 关系判定', () => {
  it('我申请了对方 → pending_sent', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'public' }),
    );
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 1n, addresseeId: 2n, status: 'pending' },
    ]);

    const result = await service.profileById('1', '2');
    expect(result.relation).toBe('pending_sent');
  });

  it('对方申请了我 → pending_received', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, profileVisibility: 'public' }),
    );
    prisma.friendship.findMany.mockResolvedValue([
      { requesterId: 2n, addresseeId: 1n, status: 'pending' },
    ]);

    const result = await service.profileById('1', '2');
    expect(result.relation).toBe('pending_received');
  });
});

describe('UsersService.profileByUid', () => {
  it('UID 大小写不敏感', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(
      buildUser({ id: 2n, publicUid: 'U0000000002' }),
    );
    prisma.friendship.findMany.mockResolvedValue([]);

    await service.profileByUid('1', 'u0000000002');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { publicUid: 'U0000000002', deleted: 0 },
    });
  });

  it('UID 不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.profileByUid('1', 'U0000000999'),
      404,
      '该 UID 不存在',
    );
  });
});

describe('UsersService.allocatePublicUid', () => {
  it('生成的 UID 形如 U + 10 位数字', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);

    const uid = await service.allocatePublicUid();
    expect(uid).toMatch(/^U\d{10}$/);
  });

  it('冲突时重试', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 1n }) // 第一次冲突
      .mockResolvedValueOnce(null);

    const uid = await service.allocatePublicUid();
    expect(uid).toMatch(/^U\d{10}$/);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
  });
});
