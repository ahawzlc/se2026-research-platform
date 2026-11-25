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
/** 专供「同组豁免」用例使用，避免与其它用例的消息计数互相干扰 */
const DAVE = `t3_d_${RUN}`;

interface ProfileBody {
  id: string;
  /**
   * 登录名——**只有看自己时后端才返回**（评审意见 C2②）。
   * 他人视角下应为 undefined。
   */
  username?: string;
  nickname: string;
  publicUid: string;
  bio: string;
  profileVisibility: string;
  relation: string;
  isSelf: boolean;
}

/**
 * 好友条目。
 *
 * 后端**不返回 username**（评审意见 C2②），
 * 所以断言一律用 publicUid 定位。
 */
interface FriendBody {
  id: string;
  publicUid: string;
  nickname: string;
  direction?: string;
  requestId?: string;
}

maybe('个人主页与好友链真库集成（线③ 卡 E-3）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: { token: string; userId: string; username: string };
  let bob: { token: string; userId: string; username: string };
  let carol: { token: string; userId: string; username: string };
  let dave: { token: string; userId: string; username: string };

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

  /**
   * 把「被拒冷却期」清掉。
   *
   * 引入冷却期（评审意见 D3）后，被拒的一方短期内不能再申请——
   * 这跟卡片原有的验收项「拒绝后可再次申请」直接冲突。
   * 那些用例要验的是**复用同一行**这个行为，不是冷却期本身，
   * 所以这里直接把 handledAt 拨到冷却期之前，等价于「冷却期已过」。
   */
  async function expireCooldown(
    requesterId: string,
    addresseeId: string,
  ): Promise<void> {
    await prisma.friendship.updateMany({
      where: {
        requesterId: BigInt(requesterId),
        addresseeId: BigInt(addresseeId),
        status: 'rejected',
      },
      data: {
        handledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
  }

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, ALICE);
    bob = await registerUser(app, BOB);
    carol = await registerUser(app, CAROL);
    dave = await registerUser(app, DAVE);
  });

  afterAll(async () => {
    // 清理顺序：先删子表再删 user（外键 ON DELETE RESTRICT）
    if (prisma) {
      const ids = [alice.userId, bob.userId, carol.userId, dave.userId].map(
        (v) => BigInt(v),
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
      // 课题组（同组豁免用例建的），先删成员再删组
      const teams = await prisma.team.findMany({
        where: { name: { startsWith: `线③同组豁免组_${RUN}` } },
        select: { id: true },
      });
      const teamIds = teams.map((t) => t.id);
      if (teamIds.length > 0) {
        await prisma.teamMember.deleteMany({
          where: { teamId: { in: teamIds } },
        });
        await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
      }
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
    const foundBody = envelope<ProfileBody>(found).data;
    expect(foundBody?.publicUid).toBe(aliceUid);
    // 评审意见 C2②：看别人的主页不返回登录名
    expect(foundBody?.username).toBeUndefined();

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
    const noteBody = envelope<{ list: { type: string; title: string }[] }>(
      notes,
    );
    const friendNote = noteBody.data?.list.find(
      (n) => n.type === 'friend_request',
    );
    expect(friendNote).toBeDefined();

    // 回归（缺陷 A1）：通知标题的主语必须是**发起人**（Alice），
    // 而不是接收人（Bob）。早期版本用了 peer 的昵称，
    // Bob 收到的通知会写成「Bob 的昵称 请求加你为好友」——他自己就是 Bob。
    const aliceNick = await prisma.user.findFirst({
      where: { username: ALICE },
      select: { nickname: true },
    });
    const bobNick = await prisma.user.findFirst({
      where: { username: BOB },
      select: { nickname: true },
    });
    expect(friendNote?.title).toBe(`${aliceNick?.nickname} 请求加你为好友`);
    // 标题里不能出现接收人自己的昵称
    expect(friendNote?.title).not.toContain(bobNick?.nickname ?? '@@none@@');

    // Bob 同意
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(201);

    // 回归（缺陷 A1）：同意通知的主语必须是**同意人**（Bob）
    const afterAccept = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const acceptBody = envelope<{ list: { type: string; title: string }[] }>(
      afterAccept,
    );
    const acceptNote = acceptBody.data?.list.find(
      (n) => n.type === 'friend_accepted',
    );
    expect(acceptNote).toBeDefined();
    expect(acceptNote?.title).toBe(`${bobNick?.nickname} 已同意你的好友申请`);
    expect(acceptNote?.title).not.toContain(aliceNick?.nickname ?? '@@none@@');

    // 双方好友列表都能看到对方（用 UID 定位——后端不返回 username）
    const bobUidInList = await uidOf(bob.token);
    const aliceUidInList = await uidOf(alice.token);
    for (const [who, otherUid] of [
      [alice, bobUidInList],
      [bob, aliceUidInList],
    ] as const) {
      const list = await request(app.getHttpServer())
        .get('/api/v1/friends')
        .set('Authorization', `Bearer ${who.token}`)
        .expect(200);
      const listBody = envelope<{ list: FriendBody[] }>(list);
      expect(listBody.data?.list.some((f) => f.publicUid === otherUid)).toBe(
        true,
      );
      // 评审意见 C2②：好友列表不返回登录名
      expect(listBody.data?.list.every((f) => !('username' in f))).toBe(true);
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

    // 冷却期已过（这里要验的是「复用同一行」，不是冷却期本身）
    await expireCooldown(alice.userId, carol.userId);

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
    await expireCooldown(alice.userId, carol.userId);
  });

  it('删除好友后双方列表都不可见（逻辑删除）', async () => {
    const bobUid = await uidOf(bob.token);
    const list = await request(app.getHttpServer())
      .get('/api/v1/friends')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const bobFriend = envelope<{ list: FriendBody[] }>(list).data?.list.find(
      (f) => f.publicUid === bobUid,
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
      expect(afterBody.data?.list.some((f) => f.publicUid === bobUid)).toBe(
        false,
      );
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
    await expireCooldown(carol.userId, alice.userId);
  });

  /**
   * 回归（真库唯一才暴露）：`uk_friendship(requester_id, addressee_id)` **有方向**，
   * 所以 A→B 与 B→A 是两个不同的键。若服务层只按自己方向查找，
   * 「A 申请过 B、B 再申请 A」会插第二行，产生「一对用户两行」的脏数据，
   * 之后双方好友列表会打架、删除一方后另一行还活着。
   *
   * 不变式：**任意时刻，一对用户之间至多存在一行 friendship**。
   */
  it('一对用户至多一行：双方互发申请不会插第二行', async () => {
    const aliceUid = await uidOf(alice.token);

    // 前面的用例已留下 Alice ↔ Bob 的一行（软删）。
    // 把它改成 rejected（双方都还能再申请），而不是 create 新行——
    // create 会撞 uk_friendship。
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          {
            requesterId: BigInt(alice.userId),
            addresseeId: BigInt(bob.userId),
          },
          {
            requesterId: BigInt(bob.userId),
            addresseeId: BigInt(alice.userId),
          },
        ],
      },
    });
    expect(existing).toBeDefined();
    await prisma.friendship.update({
      where: { id: existing!.id },
      data: { status: 'rejected', deleted: 0, handledAt: new Date() },
    });

    // Bob 反向申请 Alice → 应复用旧行并翻转方向，不新增行
    const res = await request(app.getHttpServer())
      .post('/api/v1/friends/requests')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ uid: aliceUid })
      .expect(201);
    const requestId = envelope<FriendBody>(res).data?.requestId ?? '';

    // 真库校验：仍然只有一行，且方向已翻转为 Bob → Alice
    const rows = await prisma.friendship.findMany({
      where: {
        OR: [
          {
            requesterId: BigInt(alice.userId),
            addresseeId: BigInt(bob.userId),
          },
          {
            requesterId: BigInt(bob.userId),
            addresseeId: BigInt(alice.userId),
          },
        ],
      },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].id.toString()).toBe(requestId);
    expect(rows[0].requesterId.toString()).toBe(bob.userId);
    expect(rows[0].addresseeId.toString()).toBe(alice.userId);
    expect(rows[0].status).toBe('pending');

    // 收尾：拒绝掉，恢复「非好友」状态供后续用例
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(201);
    await expireCooldown(bob.userId, alice.userId);
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
    await expireCooldown(carol.userId, alice.userId);
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

    await expireCooldown(carol.userId, alice.userId);
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

  // -------------------------------------------------- 同组豁免（缺陷 A2）

  /**
   * 回归（缺陷 A2，上线即炸的级别）。
   *
   * `friendship` 是本卡新增的表，**部署前就存在的私信会话里双方都不是好友**。
   * 若「非好友限发 1 条」不豁免同组，部署后只要任一方之前发过消息，
   * 那个会话就会被永久冻结（发第二条即 403），而用户没有别的入口。
   *
   * 口径（2026-11-24 牵头人确认）：**同组或好友都不受限**。
   *
   * 本用例模拟「存量会话」：先造好一条已有消息的会话，再让两人进同一个课题组，
   * 然后继续发消息——必须成功。
   */
  it('同组成员：存量私信会话不受限发限制（缺陷 A2）', async () => {
    // 用 Dave 单独开一对，避免与其它用例的消息计数互相干扰
    const daveUid = await uidOf(dave.token);

    // 造一条「已有消息」的会话
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private-with')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: daveUid })
      .expect(201);
    const convId = envelope<{ id: string }>(conv).data?.id ?? '';

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '存量消息' })
      .expect(201);

    // 此时两人不同组、非好友 → 第二条应被拒（对照组）
    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '同组前' })
      .expect(403);
    expect(envelope(blocked).code).toBe(403);

    // 让两人进同一个课题组
    const team = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name: `线③同组豁免组_${RUN}` })
      .expect(201);
    const inviteCode = envelope<{ inviteCode: string }>(team).data?.inviteCode;
    expect(inviteCode).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/teams/join')
      .set('Authorization', `Bearer ${dave.token}`)
      .send({ inviteCode })
      .expect(201);

    // 同组后 → 存量会话可以继续发
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '同组后可以继续说了' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${dave.token}`)
      .send({ content: '我也说一句' })
      .expect(201);
  });

  /**
   * 对照组：跨组非好友**仍然**限发 1 条（同组豁免不能放宽过头）。
   */
  it('跨组非好友：仍限发 1 条（同组豁免不放宽跨组）', async () => {
    // Alice 与 Bob 不同组（Bob 没有加入上面那个组）
    const bobUid = await uidOf(bob.token);
    const conv = await request(app.getHttpServer())
      .post('/api/v1/conversations/private-with')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: bobUid })
      .expect(201);
    const convId = envelope<{ id: string }>(conv).data?.id ?? '';

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '跨组第 1 条' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '跨组第 2 条' })
      .expect(403);
  });

  // -------------------------------------------------- 防骚扰与撤回

  /**
   * 防骚扰（评审意见 D3）：被拒后进入冷却期，短期内不能再次申请。
   */
  it('被拒冷却期内不能再向同一人申请（409）', async () => {
    // 用 Dave（此时与 Alice 只是同组、不是好友，且没有 pending/rejected 残留）
    const daveUid = await uidOf(dave.token);

    // Alice 申请 Dave → Dave 拒绝
    const requestId = await requestFriend(alice.token, daveUid);
    await request(app.getHttpServer())
      .post(`/api/v1/friends/requests/${requestId}/reject`)
      .set('Authorization', `Bearer ${dave.token}`)
      .expect(201);

    // 冷却期内再申请 → 409
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/friends/requests')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ uid: daveUid })
      .expect(409);
    expect(envelope(blocked).code).toBe(409);
    expect(envelope(blocked).message).toContain('天内不能再发起申请');
  });

  /**
   * 撤回申请（评审意见 E4）：只有申请方本人能撤回，且仅限 pending。
   */
  it('撤回申请：pending → rejected，且只有申请方能撤回', async () => {
    // 用 Bob（此时与 Alice 非好友，且前面的用例已把 Alice→Bob 清理干净）
    const bobUid = await uidOf(bob.token);

    await expireCooldown(alice.userId, bob.userId);

    const requestId = await requestFriend(alice.token, bobUid);
    expect(requestId).toBeTruthy();

    // Bob（不是申请方）撤回 → 404
    await request(app.getHttpServer())
      .delete(`/api/v1/friends/requests/${requestId}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(404);

    // Alice（申请方）撤回 → 成功
    await request(app.getHttpServer())
      .delete(`/api/v1/friends/requests/${requestId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    // 真库校验：状态变 rejected
    const row = await prisma.friendship.findFirst({
      where: { id: BigInt(requestId) },
    });
    expect(row?.status).toBe('rejected');

    // 已处理的申请不能再撤回 → 409
    await request(app.getHttpServer())
      .delete(`/api/v1/friends/requests/${requestId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(409);
  });

  /**
   * 输入校验（评审意见 D1 / D2）：
   *   - 昵称传纯空格 → 400（trim 后为空串）；
   *   - 头像传外站 URL → 400（只接受本站上传接口返回的地址）。
   */
  it('资料校验：空昵称与外站头像地址都被拒', async () => {
    // 空昵称（纯空格）
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ nickname: '   ' })
      .expect(400);

    // 外站头像地址
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ avatar: 'https://evil.example.com/track.png' })
      .expect(400);

    // 协议相对地址（//evil.com/...）也要挡掉
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ avatar: '//evil.example.com/track.png' })
      .expect(400);

    // 合法值：留空表示用默认头像
    await request(app.getHttpServer())
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ avatar: '' })
      .expect(200);
  });
});
