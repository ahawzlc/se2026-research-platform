/**
 * 通知中心真库集成（G-1 真库用例补齐，卡 T-1a 附带）。
 *
 * 真库验证点：
 *   - 冻结的 push 接口直连真库写入，HTTP 面读到的是同一条数据；
 *   - 个人维度隔离（alice 的通知 bob 读不到：404 而非 403，不泄露存在性）；
 *   - 未读数/已读幂等/全部已读在真实 UPDATE 语义下成立。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import {
  createIntegrationApp,
  envelope,
  maybe,
  registerUser,
  RUN,
} from './setup';

maybe('通知中心真库集成（G-1 补齐）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    alice = await registerUser(app, `t1n_a_${RUN}`);
    bob = await registerUser(app, `t1n_b_${RUN}`);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({
        where: {
          userId: { in: [BigInt(alice.userId), BigInt(bob.userId)] },
        },
      });
      await prisma.user.deleteMany({
        where: { username: { startsWith: 't1n_' } },
      });
    }
    await app.close();
  });

  it('push 两条（带 ref / 不带 ref）→ 未读数与列表真实落库，按 id 倒序', async () => {
    await notifications.push({
      toUserId: alice.userId,
      type: 'team_apply',
      title: '张三 申请加入《互联网+项目》',
      refType: 'community_post',
      refId: '1',
    });
    await notifications.push({
      toUserId: alice.userId,
      type: 'friend_accepted',
      title: '李四 通过了你的好友申请',
    });

    const aliceCount = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ count: number }>(aliceCount).data?.count).toBe(2);

    // 个人维度隔离：bob 的未读数不受 alice 的通知影响
    const bobCount = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(envelope<{ count: number }>(bobCount).data?.count).toBe(0);

    const list = await request(app.getHttpServer())
      .get('/api/v1/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const body = envelope<{
      list: Array<{
        id: string;
        title: string;
        refType: string;
        isRead: number;
      }>;
      total: number;
    }>(list);
    expect(body.data?.total).toBe(2);
    // id 倒序：最新一条（不带 ref）在前
    expect(body.data?.list[0].title).toBe('李四 通过了你的好友申请');
    expect(body.data?.list[0].refType).toBe('');
    expect(body.data?.list[1].refType).toBe('community_post');
    expect(body.data?.list[0].isRead).toBe(0);
  });

  it('非本人已读 404；本人已读幂等且未读数递减', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const target = envelope<{
      list: Array<{ id: string }>;
    }>(list).data?.list[0];
    expect(target).toBeTruthy();

    // bob 尝试已读 alice 的通知：404（与不存在同口径，不泄露存在性）
    const steal = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${target?.id}/read`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);
    expect(envelope<null>(steal).code).toBe(404);

    // alice 本人已读 → 未读 2→1；重复已读幂等，未读数不再变化
    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${target?.id}/read`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    const afterRead = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ count: number }>(afterRead).data?.count).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/notifications/${target?.id}/read`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    const afterRepeat = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ count: number }>(afterRepeat).data?.count).toBe(1);
  });

  it('全部已读：返回本次标记条数，未读数归零', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    expect(envelope<{ updated: number }>(res).data?.updated).toBe(1);

    const count = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ count: number }>(count).data?.count).toBe(0);
  });
});
