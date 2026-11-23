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
    const cases: Array<{ name: string; body: unknown; keyword: string }> = [
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
    const edit = async (body: unknown, keyword: string) => {
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
});
