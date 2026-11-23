/**
 * 个人主页与好友链真库集成（线③ 卡 E-3）。
 *
 * 真库验证点（mock 单测覆盖不到的）：
 *   - user.public_uid 唯一约束真实拦截 UID 冲突；
 *   - friendship.uk_friendship 唯一键真实拦截同方向重复申请；
 *   - 「拒绝后复用同一行改回 pending」在真实唯一键下成立（不会插第二行）；
 *   - 「同意后双方好友列表都可见」「删除后双方都不可见」的逻辑删除真实生效；
 *   - 非好友私信限发 1 条：计数依赖真实 message 行，mock 测不准；
 *   - 主页可见范围（public/friends/private）在真实 friendship 表上判定。
 *
 * 运行方式见 setup.ts（需 RUN_INTEGRATION=1 与真实 MySQL）。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createIntegrationApp,
  envelope,
  maybe,
  registerUser,
  RUN,
} from './setup';

const ALICE = `t3_a_${RUN}`;
const BOB = `t3_b_${RUN}`;
const CAROL = `t3_c_${RUN}`;

interface ProfileBody {
  id: string;
  username: string;
  nickname: string;
  publicUid: string;
  bio: string;
  profileVisibility: string;
  relation: string;
  isSelf: boolean;
}

interface FriendBody {
  id: string;
  username: string;
  publicUid: string;
  direction?: string;
  requestId?: string;
}

maybe('个人主页与好友链真库集成（线③ 卡 E-3）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: { token: string; userId: string; username: string };
  let bob: { token: string; userId: string; username: string };
  let carol: { token: string; userId: string; username: string };

  /** 取某人的 UID（走 /users/me，最贴近真实调用链） */
  async function uidOf(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return envelope<ProfileBody>(res).data?.publicUid ?? '';
  }

  /** 让 from 申请加 to，返回申请记录 id */
  async function requestFriend(
    fromToken: string,
    toUid: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/friends/requests')
      .set('Authorization', `Bearer ${fromToken}`)
      .send({ uid: toUid })
      .expect(201);
    return envelope<FriendBody>(res).data?.requestId ?? '';
  }

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, ALICE);
    bob = await registerUser(app, BOB);
    carol = await registerUser(app, CAROL);
  });

  afterAll(async () => {
    // 清理顺序：先删子表再删 user（外键 ON DELETE RESTRICT）
    if (prisma) {
      const ids = [alice.userId, bob.userId, carol.userId].map((v) =>
        BigInt(v),
      );
      await prisma.friendship.deleteMany({
        where: {
          OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }],
        },
      });
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.conversationMember.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
      await prisma.conversation.deleteMany({
        where: { members: { some: { userId: { in: ids } } } },
      });
      await prisma.user.deleteMany({
        where: { username: { startsWith: 't3_' } },
      });
    }
    await app.close();
  });

  // ---------------------------------------------------------------- UID

  it('注册即分配 UID，格式为 U + 10 位数字且互不相同', async () => {
    const aliceUid = await uidOf(alice.token);
    const bobUid = await uidOf(bob.token);
    expect(aliceUid).toMatch(/^U\d{10}$/);
    expect(bobUid).not.toBe(aliceUid);

    // 真库校验：UID 落库且格式正确
    const rows = await prisma.user.findMany({
      where: { username: { in: [ALICE, BOB] } },
      select: { username: true, publicUid: true },
    });
    expect(rows.every((r) => /^U\d{10}$/.test(r.publicUid ?? ''))).toBe(true);
  });

  it('按 UID 查人：大小写不敏感，找不到 → 404', async () => {
    const aliceUid = await uidOf(alice.token);

    const found = await request(app.getHttpServer())
      .get(`/api/v1/users/by-uid?uid=${aliceUid.toLowerCase()}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(envelope<ProfileBody>(found).data?.username).toBe(ALICE);

    await request(app.getHttpServer())
      .get('/api/v1/users/by-uid?uid=U9999999999')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);
  });

  // ---------------------------------------------------------------- 资料

  it('更新资料：昵称/简介/可见范围生效，UID 不可改', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        nickname: '爱丽丝',
        bio: '我是爱丽丝，研究方向是 NLP',
        profileVisibility: 'public',
      })
      .expect(200);
    const body = envelope<ProfileBody>(res);
    expect(body.data?.nickname).toBe('爱丽丝');
    expect(body.data?.bio).toContain('NLP');
    expect(body.data?.publicUid).toMatch(/^U\d{10}$/);

    // 真库校验
    const row = await prisma.user.findFirst({
      where: { username: ALICE },
      select: { nickname: true, bio: true },
    });
    expect(row?.nickname).toBe('爱丽丝');
  });

  // ---------------------------------------------------------------- 好友

  it('加好友全链路：申请 → 对方收到通知 → 同意 → 双方列表可见', async () => {
    const bobUid = await uidOf(bob.token);
    const requestId = await requestFriend(alice.token, bobUid);
    expect(requestId).toBeTruthy();

    // 真库校验：落库一行 pending
    const row = await prisma.friendship.findFirst({
      where: {
        requesterId: BigInt(alice.userId),
        addresseeId: BigInt(bob.userId),
      },
    });
    expect(row?.status).toBe('pending');

    // Bob 收到 friend_request 通知
    const notes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    const noteBody = envelope<{ list: { type: string }[] }>(notes);
    expect(noteBody.data?.list.some((n) => n.type === 'friend_request')).toBe(
      true,
    );

    // Bob 同意
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);

    // 双方好友列表都能看到对方
    for (const who of [alice, bob]) {
      const list = await request(app.getHttpServer())
        .get('/api/v1/friends')
        .set('Authorization', `Bearer ${who.token}`)
        .expect(200);
      const listBody = envelope<{ list: FriendBody[] }>(list);
      expect(listBody.data?.list.some((f) => f.username !== who.username)).toBe(
        true,
      );
    }
  });

  it('已是好友 → 不能再申请（409）', async () => {
    const bobUid = await uidOf(bob.token);
    const res = await request(app.getHttpServer())
      .post('/api/v1/friends/requests')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: bobUid })
      .expect(409);
    expect(envelope(res).code).toBe(409);
  });

  it('拒绝后可再次申请：复用同一行（唯一键不冲突）', async () => {
    const carolUid = await uidOf(carol.token);

    // Alice 申请 Carol
    const requestId = await requestFriend(alice.token, carolUid);

    // Carol 拒绝
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(201);

    // 真库校验：仍是同一行，状态变 rejected
    const afterReject = await prisma.friendship.findFirst({
      where: {
        requesterId: BigInt(alice.userId),
        addresseeId: BigInt(carol.userId),
      },
    });
    expect(afterReject?.status).toBe('rejected');

    // Alice 再次申请 → 复用同一行改回 pending，不新增行
    const again = await requestFriend(alice.token, carolUid);
    expect(again).toBe(requestId);

    const rows = await prisma.friendship.count({
      where: {
        requesterId: BigInt(alice.userId),
        addresseeId: BigInt(carol.userId),
      },
    });
    expect(rows).toBe(1);

    // 收尾：再拒绝一次，保持后续用例干净
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(201);
  });

  it('删除好友后双方列表都不可见（逻辑删除）', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/friends')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const bobFriend = envelope<{ list: FriendBody[] }>(list).data?.list.find(
      (f) => f.username === BOB,
    );
    expect(bobFriend).toBeDefined();

    await request(app.getHttpServer())
      .delete(`/api/v1/friends/${bobFriend?.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    for (const who of [alice, bob]) {
      const after = await request(app.getHttpServer())
        .get('/api/v1/friends')
        .set('Authorization', `Bearer ${who.token}`)
        .expect(200);
      const afterBody = envelope<{ list: FriendBody[] }>(after);
      expect(afterBody.data?.list.some((f) => f.username === BOB)).toBe(false);
    }
  });

  it('删除好友后可重新加（回归：唯一键不区分 deleted，必须复活旧行）', async () => {
    // 先让 Alice 与 Carol 成为好友
    const aliceUid = await uidOf(alice.token);
    const requestId = await requestFriend(carol.token, aliceUid);
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    // 删除好友（逻辑删除）
    await request(app.getHttpServer())
      .delete(`/api/v1/friends/${carol.userId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    // 真库校验：行还在，只是 deleted=1（唯一键仍占着）
    const softDeleted = await prisma.friendship.findFirst({
      where: {
        requesterId: BigInt(carol.userId),
        addresseeId: BigInt(alice.userId),
      },
    });
    expect(softDeleted?.deleted).toBe(1);

    // 重新加：不得 500（create 新行会撞 uk_friendship）
    const again = await request(app.getHttpServer())
      .post('/api/v1/friends/requests')
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ uid: aliceUid })
      .expect(201);
    expect(envelope<FriendBody>(again).code).toBe(0);

    // 真库校验：仍是同一行，被复活成 pending
    const rows = await prisma.friendship.findMany({
      where: {
        OR: [
          {
            requesterId: BigInt(carol.userId),
            addresseeId: BigInt(alice.userId),
          },
          {
            requesterId: BigInt(alice.userId),
            addresseeId: BigInt(carol.userId),
          },
        ],
      },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].deleted).toBe(0);

    // 收尾：拒绝掉
    await request(app.getHttpServer())
      .post(
        `/api/v1/friends/requests/${envelope<FriendBody>(again).data?.requestId}/reject`,
      )
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
  });

  // ---------------------------------------------------------------- 可见范围

  it('可见范围 private：他人看不到主页（403）', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ profileVisibility: 'private' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/users/${alice.userId}`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(403);

    // 恢复 public，避免影响后续用例
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ profileVisibility: 'public' })
      .expect(200);
  });

  it('可见范围 friends：非好友看不到（403），好友可以', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ profileVisibility: 'friends' })
      .expect(200);

    // Carol 不是 Alice 的好友 → 403
    await request(app.getHttpServer())
      .get(`/api/v1/users/${alice.userId}`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(403);

    // 让 Carol 成为 Alice 的好友
    const aliceUid = await uidOf(alice.token);
    const requestId = await requestFriend(carol.token, aliceUid);
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    // 好友可见
    await request(app.getHttpServer())
      .get(`/api/v1/users/${alice.userId}`)
      .set('Authorization', `Bearer ${carol.token}`)
      .expect(200);

    // 收尾：解除好友关系并恢复 public
    await request(app.getHttpServer())
      .delete(`/api/v1/friends/${carol.userId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ profileVisibility: 'public' })
      .expect(200);
  });

  // ---------------------------------------------------------------- 私信

  it('非好友私信：每方向限发 1 条，第二次被拒（403）', async () => {
    const carolUid = await uidOf(carol.token);

    // 按 UID 打开私信会话（不再要求同组）
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private-with')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: carolUid })
      .expect(201);
    const convId = envelope<{ id: string }>(conv).data?.id ?? '';

    // 第 1 条成功
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '你好，交个朋友？' })
      .expect(201);

    // 第 2 条被拒（非好友限发 1 条）
    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '再发一条试试' })
      .expect(403);
    expect(envelope(blocked).code).toBe(403);

    // 反方向：Carol 也能发 1 条
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ content: '你好' })
      .expect(201);

    // Carol 再发被拒
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ content: '第二条' })
      .expect(403);
  });

  it('成为好友后解除私信限发', async () => {
    const carolUid = await uidOf(carol.token);
    const aliceUid = await uidOf(alice.token);

    const requestId = await requestFriend(carol.token, aliceUid);
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);

    // 拿到会话并连发多条
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private-with')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: carolUid })
      .expect(201);
    const convId = envelope<{ id: string }>(conv).data?.id ?? '';

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '好友了，可以多说' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '第二条' })
      .expect(201);
  });
});
