import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/** 用真实 bcrypt 造哈希（降成本到 4 轮，只验证调用链，不测加密强度本身） */
const CORRECT_HASH = bcrypt.hashSync('Test1234', 4);
const OTHER_HASH = bcrypt.hashSync('Other123', 4);

/** user 表一行的最小快照 */
function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    username: 'zhangsan',
    passwordHash: CORRECT_HASH,
    nickname: '张三',
    avatar: '',
    email: 'zhangsan@example.com',
    createdAt: new Date('2026-10-29T02:00:00Z'),
    updatedAt: new Date('2026-10-29T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

/** 构造 mock 依赖的 AuthService；返回 mock 便于逐用例覆写返回值 */
function createService() {
  const prisma = {
    user: { findFirst: jest.fn(), create: jest.fn() },
    teamMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token-abc') };
  const config = { get: jest.fn().mockReturnValue('604800') };
  const service = new AuthService(
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  return { service, prisma, jwt };
}

/** 断言抛出的 BizException 携带指定业务码与文案 */
async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('AuthService.register', () => {
  it('用户名已存在时抛 409', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({ id: 1n });
    await expectBizError(
      service.register({
        username: 'zhangsan',
        password: 'Test1234',
        nickname: '张三',
      }),
      409,
      '用户名已存在',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('并发下唯一索引冲突（P2002）同样收敛为 409', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    await expectBizError(
      service.register({
        username: 'zhangsan',
        password: 'Test1234',
        nickname: '张三',
      }),
      409,
      '用户名已存在',
    );
  });

  it('注册成功返回令牌与安全用户信息，id 为字符串', async () => {
    const { service, prisma, jwt } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(buildUser());
    prisma.teamMember.findMany.mockResolvedValue([{ role: 'owner' }]);

    const result = await service.register({
      username: 'zhangsan',
      password: 'Test1234',
      nickname: '张三',
      email: 'zhangsan@example.com',
    });

    expect(result.token).toBe('token-abc');
    expect(result.tokenType).toBe('Bearer');
    expect(result.user).toEqual({
      id: '1',
      username: 'zhangsan',
      nickname: '张三',
      avatar: '',
      email: 'zhangsan@example.com',
    });
    // 入库的是哈希而非明文；JwtService 收到的是最终载荷（sub 为字符串）
    const createCalls = prisma.user.create.mock.calls as Array<
      [{ data: { passwordHash: string } }]
    >;
    expect(createCalls[0][0].data.passwordHash).not.toBe('Test1234');
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: '1',
      username: 'zhangsan',
      roles: ['owner'],
    });
  });
});

describe('AuthService.login', () => {
  it('用户不存在与密码错误统一报 401，不区分文案', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.login({ username: 'nobody', password: 'Test1234' }),
      401,
      '用户名或密码错误',
    );

    prisma.user.findFirst.mockResolvedValue(
      buildUser({ passwordHash: OTHER_HASH }),
    );
    await expectBizError(
      service.login({ username: 'zhangsan', password: 'Test1234' }),
      401,
      '用户名或密码错误',
    );
  });

  it('登录成功签发令牌，角色快照按入组记录去重', async () => {
    const { service, prisma, jwt } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());
    prisma.teamMember.findMany.mockResolvedValue([
      { role: 'member' },
      { role: 'member' },
      { role: 'admin' },
    ]);

    const result = await service.login({
      username: 'zhangsan',
      password: 'Test1234',
    });

    expect(result.token).toBe('token-abc');
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: '1',
      username: 'zhangsan',
      roles: ['member', 'admin'],
    });
  });
});

describe('AuthService.me', () => {
  it('载荷 id 非数字时按未授权处理', async () => {
    const { service } = createService();
    await expectBizError(service.me('abc'), 401, '未登录或登录已过期');
  });

  it('账号不存在或已删除时按未授权处理', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    await expectBizError(service.me('1'), 401, '账号不存在或已被删除');
  });

  it('返回字符串 id 与北京时间的注册时间', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(buildUser());

    const profile = await service.me('1');

    expect(profile.id).toBe('1');
    expect(profile.createdAt).toBe('2026-10-29 10:00:00');
    expect(profile).not.toHaveProperty('passwordHash');
  });
});
