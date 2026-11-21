/**
 * 认证链真库集成（卡 T-1a，线①）。
 *
 * 真库验证点（mock 单测覆盖不到的）：
 *   - user.username 唯一约束真实拦截重复注册；
 *   - bcrypt 哈希真实落库（绝无明文）；
 *   - JWT 签发→携带→受保护接口全链路；
 *   - 登录限流（内存滑窗，进程内生效）真实触发。
 *
 * 用例顺序有意安排：限流用例放最后（会占满该用户名的登录窗口），
 * IP 维度整组消耗 10 次（上限 20/分钟），不会自缚。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, envelope, maybe, RUN } from './setup';

const USERNAME = `t1a_${RUN}`;

maybe('认证链真库集成（卡 T-1a）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // 测试数据物理清理（仅测试代码允许物理删；业务代码一律逻辑删除——红线 5）
    if (prisma) {
      await prisma.user.deleteMany({
        where: { username: { startsWith: 't1a_' } },
      });
    }
    await app.close();
  });

  it('注册→注册即登录→携带令牌访问受保护接口 全链路', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: USERNAME,
        password: 'Passw0rd!2026',
        nickname: 'T1A认证链',
        email: `${USERNAME}@t.local`,
      })
      .expect(201);
    const regBody = envelope<{
      token: string;
      user: { id: string; username: string };
    }>(reg);
    expect(regBody.code).toBe(0);
    expect(regBody.data?.token).toBeTruthy();
    expect(regBody.data?.user.username).toBe(USERNAME);

    // 真库校验：密码哈希落库为 bcrypt 形态，绝无明文
    const row = await prisma.user.findFirst({
      where: { username: USERNAME },
    });
    expect(row?.passwordHash.startsWith('$2')).toBe(true);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${regBody.data?.token}`)
      .expect(200);
    const meBody = envelope<{ username: string }>(me);
    expect(meBody.code).toBe(0);
    expect(meBody.data?.username).toBe(USERNAME);
  });

  it('重复用户名注册被唯一约束挡住（409）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: USERNAME,
        password: 'Passw0rd!2026',
        nickname: '重复注册',
        email: `dup_${USERNAME}@t.local`,
      })
      .expect(409);
    expect(envelope<null>(res).code).toBe(409);
  });

  it('登录：正确密码成功、错误密码 401', async () => {
    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: 'Passw0rd!2026' })
      .expect(201);
    expect(envelope<{ token: string }>(ok).data?.token).toBeTruthy();

    const bad = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: 'wrong-password' })
      .expect(401);
    expect(envelope<null>(bad).code).toBe(401);
  });

  it('邮箱为可选：不传或传空串均注册成功且落库存空串（Issue #42 防复发）', async () => {
    const noEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: `t1a_n1_${RUN}`,
        password: 'Passw0rd!2026',
        nickname: '无邮箱注册',
      })
      .expect(201);
    expect(envelope<null>(noEmail).code).toBe(0);

    const emptyEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: `t1a_n2_${RUN}`,
        password: 'Passw0rd!2026',
        nickname: '空串邮箱注册',
        email: '',
      })
      .expect(201);
    expect(envelope<null>(emptyEmail).code).toBe(0);

    // 落库口径：未提供时存空串（列 NOT NULL DEFAULT ''）
    const rows = await prisma.user.findMany({
      where: {
        username: { in: [`t1a_n1_${RUN}`, `t1a_n2_${RUN}`] },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.email === '')).toBe(true);
  });

  it('同一账号 1 分钟内第 6 次登录触发限流 400「尝试过于频繁」', async () => {
    // 前序用例已消耗该用户名 2 次登录（成功 1 + 失败 1）；
    // 再补 3 次失败到达第 5 次（均 401），第 6 次触发用户名维度限流（5 次/分钟）
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: USERNAME, password: 'wrong-password' })
        .expect(401);
      expect(envelope<null>(res).code).toBe(401);
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: USERNAME, password: 'wrong-password' })
      .expect(400);
    const body = envelope<null>(blocked);
    expect(body.code).toBe(400);
    expect(body.message).toContain('尝试过于频繁');
  });
});
