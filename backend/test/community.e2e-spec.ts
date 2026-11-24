import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { API_PREFIX } from '../src/common/result';

/** 统一返回体形状，避免在断言里到处出现 any */
interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

function envelope<T>(res: { body: unknown }): Envelope<T> {
  return res.body as Envelope<T>;
}

interface TagItem {
  id: string;
  name: string;
  category: string;
}

/** 申请条目（断言时只取关心的字段） */
interface ApplicationRow {
  id: string;
  postId: string;
  status: string;
  note: string;
  handledAt: string;
}

/**
 * 组队广场 HTTP 层验收（卡 E-1）：真实 JWT / DTO / Service，替身数据库。
 *
 * 覆盖单测够不到的两层：
 *   - 鉴权链路：广场接口未登录一律 401；
 *   - DTO 校验：任务卡验收项「无标签提交被 DTO 拦截」等边界经真实 ValidationPipe 生效。
 * SQL 行为（逻辑删除过滤、唯一约束）由 test/integration/community.int-spec.ts 在真库验证。
 */
describe('组队广场 (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  /** 帖子一行（带关系），供回读类查询返回 */
  const postRow = {
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
    author: { id: 1n, nickname: '张三', avatar: '' },
    team: null,
    tags: [{ tag: { id: 1n, name: '互联网+', category: 'competition' } }],
  };

  const tx = {
    communityPost: { create: jest.fn(), update: jest.fn() },
    communityPostTag: { createMany: jest.fn() },
    teamApplication: { create: jest.fn(), updateMany: jest.fn() },
    // 申请 / 审批会在同一事务里经真实的 NotificationsService 写通知
    notification: {
      create: jest.fn().mockResolvedValue({
        id: 50n,
        userId: 2n,
        type: 'team_apply',
        title: '张三 申请加入你的帖子《互联网+项目招前端》',
        refType: 'community_post',
        refId: 5n,
        isRead: 0,
        createdAt: new Date('2026-11-24T01:00:00Z'),
        updatedAt: new Date('2026-11-24T01:00:00Z'),
        deleted: 0,
      }),
    },
  };
  const prisma = {
    ...tx,
    communityPost: {
      ...tx.communityPost,
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    communityPostTag: { ...tx.communityPostTag, findMany: jest.fn() },
    communityTag: { findMany: jest.fn() },
    // 帖子结构里的 myApplication / pendingCount 走两次批量查询，默认返回「没申请过」
    teamApplication: {
      ...tx.teamApplication,
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    user: { findFirstOrThrow: jest.fn() },
    teamMember: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  /**
   * 带登录态的请求。请求头必须设在具体的 get/post 实例上——
   * 设在 request() 工厂对象上不会带到随后新建的请求（会全部变成未登录的 401）。
   * 逐方法显式分支而不是按方法名索引调用，后者会让返回值退化成 any。
   */
  function authed(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
  ): request.Test {
    const server = app.getHttpServer();
    const url = `/api/v1/community${path}`;
    const req =
      method === 'get'
        ? request(server).get(url)
        : method === 'post'
          ? request(server).post(url)
          : method === 'put'
            ? request(server).put(url)
            : request(server).delete(url);
    return req.set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    token = await app.get(AuthService).sign({ userId: '1', username: 'e2e' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks 不复位返回值：把用例里互相覆盖过的几处复位，保证每条用例起点一致
    prisma.communityPost.findFirst.mockResolvedValue(null);
    prisma.teamApplication.findFirst.mockResolvedValue(null);
    prisma.teamApplication.findMany.mockResolvedValue([]);
    prisma.teamApplication.groupBy.mockResolvedValue([]);
    prisma.teamMember.findFirst.mockResolvedValue(null);
  });

  it('未登录访问广场接口返回 401 与业务错误码', async () => {
    for (const path of ['/posts', '/tags', '/posts/5']) {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/community${path}`,
      );
      expect(res.status).toBe(401);
      expect(envelope<null>(res).code).toBe(401);
    }
    expect(prisma.communityPost.findMany).not.toHaveBeenCalled();
  });

  it('发帖成功：统一返回体 code=0，data 为帖子结构', async () => {
    prisma.communityTag.findMany.mockResolvedValue([{ id: 1n }, { id: 6n }]);
    tx.communityPost.create.mockResolvedValue({ id: 5n });
    prisma.communityPost.findFirst.mockResolvedValue(postRow);

    const res = await authed('post', '/posts')
      .send({
        title: '互联网+项目招前端',
        content: '做一个校园二手书平台',
        tagIds: ['1', '6'],
        recruitTotal: 4,
      })
      .expect(201);

    const body = envelope<{
      id: string;
      isAuthor: boolean;
      tags: TagItem[];
    }>(res);
    expect(body.code).toBe(0);
    expect(body.message).toBe('ok');
    expect(body.data).toMatchObject({
      id: '5',
      isAuthor: true,
      tags: [{ id: '1', name: '互联网+' }],
    });
  });

  it('发帖 DTO：标签必选 1-3 个且不可重复，非法入参一律 400', async () => {
    const valid = { title: '毕业设计组队', tagIds: ['1'] };
    const cases: Array<{
      name: string;
      body: Record<string, unknown>;
      keyword: string;
    }> = [
      { name: '无标签', body: { title: valid.title }, keyword: 'tagIds' },
      {
        name: '空标签数组',
        body: { ...valid, tagIds: [] },
        keyword: '至少选择',
      },
      {
        name: '4 个标签',
        body: { ...valid, tagIds: ['1', '2', '3', '4'] },
        keyword: '最多选择',
      },
      {
        name: '标签重复',
        body: { ...valid, tagIds: ['1', '1'] },
        keyword: '不能重复',
      },
      {
        name: '标签 id 非数字',
        body: { ...valid, tagIds: ['abc'] },
        keyword: '合法 id',
      },
      {
        name: '标题空白',
        body: { ...valid, title: '   ' },
        keyword: '不能为空',
      },
      {
        name: '标题超 50 字',
        body: { ...valid, title: '标'.repeat(51) },
        keyword: '最长 50',
      },
      {
        name: '说明超 5000 字',
        body: { ...valid, content: '长'.repeat(5001) },
        keyword: '最长 5000',
      },
      {
        name: '招募人数 0',
        body: { ...valid, recruitTotal: 0 },
        keyword: '最少为 1',
      },
      {
        name: '招募人数 11',
        body: { ...valid, recruitTotal: 11 },
        keyword: '最多为 10',
      },
      {
        name: '招募人数非整数',
        body: { ...valid, recruitTotal: 2.5 },
        keyword: '整数',
      },
      {
        name: '多余字段',
        body: { ...valid, status: 'full' },
        keyword: 'should not exist',
      },
    ];
    // 没被 400 拦下的入参全部收进来，一次性断言为空：失败时能直接看出是哪几条漏网
    const notBlocked: Array<{
      case: string;
      keyword: string;
      response: Envelope<null>;
    }> = [];
    for (const { name, body, keyword } of cases) {
      const res = await authed('post', '/posts').send(body);
      const response = envelope<null>(res);
      const blocked =
        res.status === 400 &&
        response.code === 400 &&
        response.message.includes(keyword);
      if (!blocked) {
        notBlocked.push({ case: name, keyword, response });
      }
    }
    expect(notBlocked).toEqual([]);
    // 被拦截的请求不触达数据层
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('编辑 DTO：至少传一个字段，传入字段的规则与发布一致', async () => {
    const edit = async (body: Record<string, unknown>, keyword: string) => {
      const res = await authed('put', '/posts/5').send(body);
      expect(res.status).toBe(400);
      expect(envelope<null>(res).message).toContain(keyword);
    };

    await edit({}, '至少提供');
    await edit({ title: '' }, '不能为空');
    await edit({ tagIds: [] }, '至少选择');
    await edit({ status: 'closed' }, 'should not exist');
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled();
  });

  it('列表查询参数：状态 / 标签 / 分页越界一律 400', async () => {
    const cases: Array<[string, string]> = [
      ['status=open', '取值非法'],
      ['tags=abc', '标签 id'],
      ['size=101', '最大为 100'],
      ['page=0', '最小为 1'],
    ];
    for (const [query, keyword] of cases) {
      const res = await authed('get', `/posts?${query}`);
      expect(res.status).toBe(400);
      expect(envelope<null>(res).message).toContain(keyword);
    }
    expect(prisma.communityPost.findMany).not.toHaveBeenCalled();
  });

  it('列表与标签字典：透传筛选并返回分页信封', async () => {
    prisma.communityPost.count.mockResolvedValue(1);
    prisma.communityPost.findMany.mockResolvedValue([postRow]);

    const list = await authed(
      'get',
      '/posts?tags=1,6&q=前端&status=recruiting&mine=true&page=2&size=5',
    ).expect(200);
    const page = envelope<{ total: number; page: number; size: number }>(list);
    expect(page.data).toMatchObject({ total: 1, page: 2, size: 5 });
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deleted: 0,
          status: 'recruiting',
          userId: 1n,
          tags: { some: { tagId: { in: [1n, 6n] }, deleted: 0 } },
          OR: [
            { title: { contains: '前端' } },
            { content: { contains: '前端' } },
          ],
        },
        skip: 5,
        take: 5,
      }),
    );

    prisma.communityTag.findMany.mockResolvedValue([
      { id: 1n, name: '互联网+', category: 'competition' },
      { id: 6n, name: '软件工程', category: 'course' },
    ]);
    const tags = await authed('get', '/tags').expect(200);
    expect(envelope<TagItem[]>(tags).data).toEqual([
      { id: '1', name: '互联网+', category: 'competition' },
      { id: '6', name: '软件工程', category: 'course' },
    ]);
  });

  it('路径 id 非法 → 404，不查库', async () => {
    const res = await authed('get', '/posts/abc').expect(404);
    expect(envelope<null>(res)).toMatchObject({
      code: 404,
      message: '帖子不存在',
    });
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled();
  });

  it('非作者编辑 / 停止 / 删除 → 403，不发生写入', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({
      ...postRow,
      userId: 2n,
    });

    const responses = [
      await authed('put', '/posts/5').send({ title: '改一下' }),
      await authed('post', '/posts/5/close'),
      await authed('delete', '/posts/5'),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(envelope<null>(res).code).toBe(403);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.communityPost.update).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- 卡 E-2 申请与审批

  /** 申请一行（带申请人），供回读返回 */
  const applicationRow = {
    id: 31n,
    postId: 5n,
    userId: 1n,
    note: '我会前端',
    status: 'pending',
    handledBy: null,
    handledAt: null,
    createdAt: new Date('2026-11-24T01:00:00Z'),
    updatedAt: new Date('2026-11-24T01:00:00Z'),
    deleted: 0,
    applicant: { id: 1n, nickname: '张三', avatar: '' },
  };

  it('申请说明超长 / 多余字段 → 400；申请列表的状态与分页越界 → 400', async () => {
    const tooLong = await authed('post', '/posts/5/apply').send({
      note: '长'.repeat(201),
    });
    expect(tooLong.status).toBe(400);
    expect(envelope<null>(tooLong).message).toContain('最长 200');

    const extra = await authed('post', '/posts/5/apply').send({
      note: '你好',
      status: 'approved',
    });
    expect(envelope<null>(extra).message).toContain('should not exist');

    for (const query of ['status=open', 'size=101', 'page=0']) {
      const res = await authed('get', `/posts/5/applications?${query}`);
      expect(res.status).toBe(400);
    }
    // 被拦截的请求不触达数据层
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('申请自己的帖子 → 400；已满员 / 已停止 → 409', async () => {
    prisma.communityPost.findFirst.mockResolvedValue(postRow);
    const own = await authed('post', '/posts/5/apply').send({ note: '我来' });
    expect(own.status).toBe(400);
    expect(envelope<null>(own).message).toBe('不能申请自己的帖子');

    for (const [status, message] of [
      ['full', '帖子已满员'],
      ['closed', '帖子已停止招募'],
    ] as const) {
      prisma.communityPost.findFirst.mockResolvedValue({
        ...postRow,
        userId: 2n,
        status,
      });
      const res = await authed('post', '/posts/5/apply').send({});
      expect(res.status).toBe(409);
      expect(envelope<null>(res).message).toBe(message);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('申请成功：说明去首尾空白后落库，返回待处理的申请条目', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({
      ...postRow,
      userId: 2n,
      recruitedCount: 0,
    });
    prisma.teamApplication.findFirst.mockResolvedValue(null);
    prisma.user.findFirstOrThrow.mockResolvedValue({ nickname: '张三' });
    tx.teamApplication.create.mockResolvedValue({ id: 31n });
    prisma.teamApplication.findFirstOrThrow.mockResolvedValue(applicationRow);

    const res = await authed('post', '/posts/5/apply')
      .send({ note: ' 我会前端 ' })
      .expect(201);

    expect(tx.teamApplication.create).toHaveBeenCalledWith({
      data: { postId: 5n, userId: 1n, note: '我会前端' },
      select: { id: true },
    });
    // 通知发帖人与申请在同一事务里，经 NotificationsService 写入（跳转来源指向帖子）
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 2n,
        type: 'team_apply',
        title: '张三 申请加入你的帖子《互联网+项目招前端》',
        refType: 'community_post',
        refId: 5n,
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(envelope<ApplicationRow>(res).data).toMatchObject({
      id: '31',
      postId: '5',
      status: 'pending',
      note: '我会前端',
      handledAt: '',
    });
  });

  it('已有申请（待处理 / 已通过 / 已拒绝）→ 409，不写入第二条', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({
      ...postRow,
      userId: 2n,
    });
    for (const status of ['pending', 'approved', 'rejected']) {
      prisma.teamApplication.findFirst.mockResolvedValue({ status });
      const res = await authed('post', '/posts/5/apply').send({});
      expect(res.status).toBe(409);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.teamApplication.create).not.toHaveBeenCalled();
  });

  it('已在该帖课题组的成员（如凭邀请码先入组）→ 409，不写入申请', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({
      ...postRow,
      userId: 2n,
      teamId: 7n,
    });
    prisma.teamApplication.findFirst.mockResolvedValue(null);
    prisma.teamMember.findFirst.mockResolvedValue({ id: 101n });

    const res = await authed('post', '/posts/5/apply').send({});
    expect(res.status).toBe(409);
    expect(envelope<null>(res).message).toBe('你已在该课题组中，无需申请');
    // 审批通过会让进度 +1，而组里并没有新增成员：在申请入口拦下
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.teamApplication.create).not.toHaveBeenCalled();
  });

  it('非发帖人查看申请列表 / 审批 → 403', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({
      ...postRow,
      userId: 2n,
    });
    const list = await authed('get', '/posts/5/applications');
    expect(list.status).toBe(403);
    expect(prisma.teamApplication.findMany).not.toHaveBeenCalled();

    prisma.teamApplication.findFirst.mockResolvedValue(applicationRow);
    for (const action of ['approve', 'reject']) {
      const res = await authed('post', `/applications/31/${action}`);
      expect(res.status).toBe(403);
      expect(envelope<null>(res).code).toBe(403);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('发帖人查看申请列表：按状态过滤并返回分页信封', async () => {
    prisma.communityPost.findFirst.mockResolvedValue(postRow);
    prisma.teamApplication.count.mockResolvedValue(1);
    prisma.teamApplication.findMany.mockResolvedValue([applicationRow]);

    const res = await authed(
      'get',
      '/posts/5/applications?status=pending',
    ).expect(200);
    const page = envelope<{
      total: number;
      list: Array<{ id: string; status: string }>;
    }>(res);
    expect(page.data).toMatchObject({ total: 1, page: 1, size: 20 });
    expect(page.data?.list[0]).toMatchObject({ id: '31', status: 'pending' });
    expect(prisma.teamApplication.count).toHaveBeenCalledWith({
      where: { postId: 5n, deleted: 0, status: 'pending' },
    });
  });

  it('审批不存在的申请 → 404；申请已处理 → 409', async () => {
    prisma.teamApplication.findFirst.mockResolvedValue(null);
    const missing = await authed('post', '/applications/31/approve');
    expect(missing.status).toBe(404);
    expect(envelope<null>(missing).message).toBe('申请不存在');

    prisma.teamApplication.findFirst.mockResolvedValue({
      ...applicationRow,
      status: 'approved',
    });
    prisma.communityPost.findFirst.mockResolvedValue(postRow);
    const done = await authed('post', '/applications/31/approve');
    expect(done.status).toBe(409);
    expect(envelope<null>(done).message).toBe('该申请已处理');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
