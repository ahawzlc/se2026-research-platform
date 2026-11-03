import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { analyze } from '../src/activity/analysis/participation';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { Prisma } from '@prisma/client';
import { LOG_LIMIT } from '../src/activity/analysis/participation';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

type StatsData = ReturnType<typeof analyze> & {
  teamId: string;
  list: ReturnType<typeof analyze>['details'];
  total: number;
  page: number;
  size: number;
};
function payload(res: { body: unknown }): { code: number; data: StatsData } {
  return res.body as { code: number; data: StatsData };
}

const tx = {
  team: { findFirst: jest.fn() },
  teamMember: { findFirst: jest.fn(), findMany: jest.fn() },
  activityLog: { findMany: jest.fn() },
  task: { findMany: jest.fn() },
  message: { findMany: jest.fn() },
};
const transaction = jest.fn((callback: (client: typeof tx) => unknown) =>
  callback(tx),
);
const event = (id: bigint, type = 'task_create', refType = 'task') => ({
  id,
  userId: 1n,
  teamId: 8n,
  type,
  refType,
  refId: id,
  weight: new Prisma.Decimal(3),
  createdAt: new Date('2026-11-01T16:00:00Z'),
});

describe('D-1 HTTP 验收（真实 JWT/DTO/服务，替身数据库）', () => {
  let app: INestApplication<App>;
  let token: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $transaction: transaction })
      .compile();
    app = module.createNestApplication<App>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    token = await app.get(AuthService).sign({ userId: '1', username: '验收' });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    tx.team.findFirst.mockResolvedValue({ id: 8n });
    tx.teamMember.findFirst.mockResolvedValue({ id: 1n });
    tx.teamMember.findMany.mockResolvedValue([
      { userId: 1n, user: { nickname: '甲' } },
    ]);
    tx.activityLog.findMany.mockResolvedValue([event(9007199254740993n)]);
    tx.task.findMany.mockResolvedValue([]);
    tx.message.findMany.mockResolvedValue([]);
  });
  afterAll(async () => {
    await app.close();
  });
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/stats/contribution${path}`)
      .set('Authorization', `Bearer ${token}`);
  it('独立只读 smoke 脚本通过实际 HTTP socket 验收', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolve(__dirname, '../../scripts/acceptance/d1-smoke.mjs')],
      {
        env: {
          ...process.env,
          BASE_URL: await app.getUrl(),
          TOKEN: token,
          TEAM_ID: '8',
        },
      },
    );
    expect(stdout).toContain('D-1 只读验收通过');
    expect(stdout).not.toContain(token);
  });
  it('未登录/伪造令牌 401，不读数据库', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/stats/contribution?teamId=8')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/stats/contribution/details?teamId=8')
      .set('Authorization', 'Bearer fake')
      .expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([
    '',
    '?teamId=abc',
    '?teamId=0',
    '?teamId=01',
    '?teamId=18446744073709551616',
    '?teamId=8&extra=1',
  ])('非法汇总参数 %s', async (suffix) => {
    const res = await get(suffix).expect(400);
    expect(payload(res).code).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([
    'page=0',
    'size=101',
    'size=x',
    'userId=-1',
    'userId=18446744073709551616',
    'dimension=private',
    'unexpected=1',
  ])('非法明细参数 %s', async (suffix) => {
    await get(`/details?teamId=8&${suffix}`).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('非成员访问两个接口均 403', async () => {
    tx.teamMember.findFirst.mockResolvedValue(null);
    await get('?teamId=8').expect(403);
    await get('/details?teamId=8').expect(403);
    expect(tx.activityLog.findMany).not.toHaveBeenCalled();
  });
  it('不存在或已删除的组 404', async () => {
    tx.team.findFirst.mockResolvedValue(null);
    await get('?teamId=8').expect(404);
    expect(tx.teamMember.findMany).not.toHaveBeenCalled();
  });
  it('汇总/明细/周趋势对账，大 id/时区正确，强制团队和软删条件', async () => {
    const summary = await get('?teamId=8').expect(200);
    const details = await get('/details?teamId=8').expect(200);
    expect(payload(summary).code).toBe(0);
    expect(payload(summary).data).toMatchObject({
      teamId: '8',
      sampleSize: 1,
      weekly: [{ weekStart: '2026-11-02', count: 1, weight: 3 }],
    });
    expect(payload(details).data).toMatchObject({
      total: 1,
      page: 1,
      size: 10,
      list: [
        {
          id: '9007199254740993',
          userId: '1',
          createdAt: '2026-11-02 00:00:00',
          counted: true,
        },
      ],
    });
    expect(tx.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: 8n, userId: 1n, deleted: 0, user: { deleted: 0 } },
      }),
    );
    expect(tx.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: 8n, userId: { in: [1n] } },
        take: LOG_LIMIT + 1,
      }),
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
  it('过滤/分页在全组规则后执行，不重置去重', async () => {
    tx.activityLog.findMany.mockResolvedValue([
      event(1n),
      { ...event(2n), refId: 1n },
    ]);
    const res = await get(
      '/details?teamId=8&userId=1&dimension=task&page=1&size=1',
    ).expect(200);
    expect(payload(res).data).toMatchObject({
      total: 2,
      list: [{ id: '2', reason: 'duplicate', countedWeight: 0 }],
    });
    expect(
      payload(await get('/details?teamId=8&page=3&size=1')).data.list,
    ).toEqual([]);
  });
  it('空样本不给 0 分', async () => {
    tx.activityLog.findMany.mockResolvedValue([]);
    expect(payload(await get('?teamId=8')).data).toMatchObject({
      hasData: false,
      members: [],
      weekly: [],
    });
  });
  it('完成任务和评论校验业务有效性', async () => {
    tx.activityLog.findMany.mockResolvedValue([
      event(1n, 'task_done'),
      event(2n, 'comment_create', 'message'),
    ]);
    const result = await get('/details?teamId=8').expect(200);
    expect(
      payload(result).data.list.map((d: { reason: string }) => d.reason),
    ).toEqual(['invalid_comment', 'inactive_task']);
    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [1n] },
          deleted: 0,
          status: 'done',
          project: { teamId: 8n, deleted: 0 },
        },
      }),
    );
    expect(tx.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [2n] },
          deleted: 0,
          conversation: { deleted: 0, type: 'comment' },
        },
      }),
    );
    tx.task.findMany.mockResolvedValue([{ id: 1n }]);
    tx.message.findMany.mockResolvedValue([{ id: 2n, senderId: 1n }]);
    expect(payload(await get('?teamId=8')).data.sampleSize).toBe(2);
  });
  it('超过容量明确失败，不截断统计', async () => {
    tx.activityLog.findMany.mockResolvedValue(
      Array.from({ length: LOG_LIMIT + 1 }, () => event(1n)),
    );
    await get('?teamId=8').expect(400);
  });
});
