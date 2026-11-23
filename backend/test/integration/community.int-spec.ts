/**
 * 组队广场真库集成（线②，卡 E-1 帖子与标签 / 卡 E-2 申请与审批）。
 *
 * 真库验证点（mock 单测覆盖不到的）：
 *   - uk_community_post_tag(post_id, tag_id) 不过滤软删行：标签移除后再加回必须复用原行，
 *     直接 create 会撞唯一键；
 *   - 逻辑删除过滤真实生效：删帖后列表与详情不可见，行仍在库中；
 *   - 筛选 SQL 行为：多标签 some + in、关键词匹配标题或正文、分页的 count 与 list 一致；
 *   - 唯一约束兜底：uk_team_member / uk_team_application 在绕过 service 直接写入时真实拦截；
 *   - 通过申请的原子事务：自动建组、入组、名额 +1、招满转态在库里同时成立；
 *   - 并发防超招：只剩 1 个名额时两个审批请求同时到达，恰好一人通过、落败方事务回滚。
 *
 * 数据隔离：用户名前缀 t2c_ + 运行时间戳；用例标题带同一时间戳作为筛选标记；
 * 开场与收尾各清理一次（按外键依赖顺序物理删，仅测试代码允许物理删）。
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

const PREFIX = 't2c_';

interface TagItem {
  id: string;
  name: string;
  category: string;
}

interface PostItem {
  id: string;
  title: string;
  content: string;
  recruitTotal: number;
  recruitedCount: number;
  status: string;
  tags: TagItem[];
  author: { id: string; nickname: string; avatar: string };
  team: { id: string; name: string } | null;
  isAuthor: boolean;
  myApplication: { id: string; status: string } | null;
  pendingCount: number;
}

interface ApplicationRow {
  id: string;
  postId: string;
  status: string;
  note: string;
  createdAt: string;
  handledAt: string;
  applicant: { id: string; nickname: string };
}

/** 审批（通过 / 拒绝）的响应 */
interface HandleResult {
  application: ApplicationRow;
  post: {
    recruitedCount: number;
    recruitTotal: number;
    status: string;
    team: { id: string; name: string } | null;
  };
  inviteCode?: string;
}

/** 通知条目（断言时只取关心的字段） */
interface NoticeRow {
  type: string;
  title: string;
  refType: string;
  refId: string;
  isRead: number;
}

interface User {
  token: string;
  userId: string;
  username: string;
}

maybe('组队广场真库集成（线②）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: User;
  let bob: User;
  /** 另两位申请人：用于并发审批与满员后的申请 */
  let carol: User;
  let dave: User;
  /** 字典标签按名字取，不依赖种子 id 的顺序 */
  let tag: Record<'internet' | 'software' | 'modeling' | 'innovation', TagItem>;

  /** 带登录态的请求（请求头必须设在具体的 get/post 实例上） */
  function api(token: string) {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) =>
        auth(request(server).get(`/api/v1/community${path}`)),
      post: (path: string, body?: Record<string, unknown>) =>
        auth(request(server).post(`/api/v1/community${path}`)).send(body),
      put: (path: string, body?: Record<string, unknown>) =>
        auth(request(server).put(`/api/v1/community${path}`)).send(body),
      del: (path: string) =>
        auth(request(server).delete(`/api/v1/community${path}`)),
    };
  }

  async function createPost(
    user: User,
    payload: {
      title: string;
      content?: string;
      tagIds: string[];
      recruitTotal?: number;
    },
  ): Promise<PostItem> {
    const res = await api(user.token).post('/posts', payload).expect(201);
    const item = envelope<PostItem>(res).data;
    if (!item) throw new Error(`发帖失败：${JSON.stringify(res.body)}`);
    return item;
  }

  /** 按标题标记查广场列表，返回 id 集合 */
  async function listIds(token: string, query: string): Promise<string[]> {
    const res = await api(token).get(`/posts?${query}`).expect(200);
    return envelope<{ list: PostItem[] }>(res).data!.list.map(
      (item) => item.id,
    );
  }

  /**
   * 物理清理本套件产生的数据（仅测试代码允许物理删），按外键依赖顺序：
   * 通知 → 申请 → 标签关联 → 帖子 → 组成员 → 课题组 → 用户。
   */
  async function purge() {
    const users = await prisma.user.findMany({
      where: { username: { startsWith: PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) return;
    const posts = await prisma.communityPost.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const postIds = posts.map((post) => post.id);
    const teams = await prisma.team.findMany({
      where: { ownerId: { in: userIds } },
      select: { id: true },
    });
    const teamIds = teams.map((team) => team.id);

    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.teamApplication.deleteMany({
      where: { OR: [{ postId: { in: postIds } }, { userId: { in: userIds } }] },
    });
    await prisma.communityPostTag.deleteMany({
      where: { postId: { in: postIds } },
    });
    await prisma.communityPost.deleteMany({ where: { id: { in: postIds } } });
    await prisma.teamMember.deleteMany({
      where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] },
    });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    await purge();
    alice = await registerUser(app, `${PREFIX}a_${RUN}`);
    bob = await registerUser(app, `${PREFIX}b_${RUN}`);
    carol = await registerUser(app, `${PREFIX}c_${RUN}`);
    dave = await registerUser(app, `${PREFIX}d_${RUN}`);

    const res = await api(alice.token).get('/tags').expect(200);
    const all = envelope<TagItem[]>(res).data ?? [];
    const byName = (name: string) => {
      const found = all.find((item) => item.name === name);
      if (!found) throw new Error(`字典缺少标签：${name}`);
      return found;
    };
    tag = {
      internet: byName('互联网+'),
      software: byName('软件工程'),
      modeling: byName('数学建模'),
      innovation: byName('大创项目'),
    };
    // 字典：8 条种子，竞赛 5 条在前、课程 3 条在后
    expect(all).toHaveLength(8);
    expect(all.map((item) => item.category)).toEqual([
      ...Array.from({ length: 5 }, () => 'competition'),
      ...Array.from({ length: 3 }, () => 'course'),
    ]);
  });

  afterAll(async () => {
    if (prisma) await purge();
    await app.close();
  });

  it('发帖：帖子与标签关联真实落库，列表与详情返回发布人、标签与 isAuthor', async () => {
    const title = `IT发帖_${RUN}`;
    const item = await createPost(alice, {
      title,
      content: '做一个校园二手书平台，缺前端',
      tagIds: [tag.internet.id, tag.software.id],
      recruitTotal: 3,
    });

    expect(item).toMatchObject({
      title,
      content: '做一个校园二手书平台，缺前端',
      recruitTotal: 3,
      recruitedCount: 0,
      status: 'recruiting',
      isAuthor: true,
      team: null,
    });
    expect(item.tags.map((t) => t.name).sort()).toEqual([
      '互联网+',
      '软件工程',
    ]);
    // 发布人卡片只含 id / 昵称 / 头像
    expect(item.author).toEqual({
      id: alice.userId,
      nickname: `测试-${alice.username}`,
      avatar: '',
    });
    expect(Object.keys(item.author).sort()).toEqual([
      'avatar',
      'id',
      'nickname',
    ]);

    // 真库：帖子一行、标签关联两行
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(item.id) } }),
    ).toMatchObject({
      title,
      recruitTotal: 3,
      recruitedCount: 0,
      status: 'recruiting',
      deleted: 0,
    });
    expect(
      await prisma.communityPostTag.findMany({
        where: { postId: BigInt(item.id) },
      }),
    ).toHaveLength(2);

    // 他人视角：详情可读、isAuthor=false；广场列表可见
    const bobView = envelope<PostItem>(
      await api(bob.token).get(`/posts/${item.id}`).expect(200),
    ).data!;
    expect(bobView.isAuthor).toBe(false);
    expect(bobView.author.id).toBe(alice.userId);
    expect(await listIds(bob.token, `q=${encodeURIComponent(title)}`)).toEqual([
      item.id,
    ]);

    // 字典外的标签 → 400，且不落库
    const bad = await api(alice.token)
      .post('/posts', { title: `IT非法_${RUN}`, tagIds: ['999999999'] })
      .expect(400);
    expect(envelope<null>(bad).message).toContain('标签不存在');
    await expect(
      prisma.communityPost.count({ where: { title: `IT非法_${RUN}` } }),
    ).resolves.toBe(0);
  });

  it('筛选：标签 / 关键词（标题或正文）/ 状态 / 只看我的 与分页在 SQL 层生效', async () => {
    const marker = `IT筛选${RUN}`;
    const contentWord = `凯甲${RUN}`;
    // 甲、乙共标签「数学建模」；丙是对照（另一标签）。关键词只在乙的正文里
    const a = await createPost(alice, {
      title: `${marker}甲`,
      tagIds: [tag.modeling.id],
    });
    const b = await createPost(alice, {
      title: `${marker}乙`,
      content: `正文里的独有词${contentWord}`,
      tagIds: [tag.modeling.id],
    });
    const c = await createPost(alice, {
      title: `${marker}丙`,
      tagIds: [tag.innovation.id],
    });
    const byMarker = `q=${encodeURIComponent(marker)}`;

    // 标签：命中任一即返回，对照帖不出现
    expect(
      (await listIds(bob.token, `${byMarker}&tags=${tag.modeling.id}`)).sort(),
    ).toEqual([a.id, b.id].sort());
    // 关键词匹配正文
    expect(
      await listIds(bob.token, `q=${encodeURIComponent(contentWord)}`),
    ).toEqual([b.id]);
    // 只看我的：bob 没发帖
    expect(await listIds(bob.token, `${byMarker}&mine=true`)).toEqual([]);
    expect(
      (await listIds(alice.token, `${byMarker}&mine=true`)).sort(),
    ).toEqual([a.id, b.id, c.id].sort());
    // 分页：total 与 list 一致
    const page1 = envelope<{
      list: PostItem[];
      total: number;
      page: number;
      size: number;
    }>(
      await api(bob.token).get(`/posts?${byMarker}&size=2&page=1`).expect(200),
    ).data!;
    expect(page1).toMatchObject({ total: 3, page: 1, size: 2 });
    expect(page1.list).toHaveLength(2);
    expect(await listIds(bob.token, `${byMarker}&size=2&page=2`)).toHaveLength(
      1,
    );

    // 状态：停止丙后，closed 筛选只剩丙，recruiting 不含丙
    await api(alice.token).post(`/posts/${c.id}/close`).expect(201);
    expect(await listIds(bob.token, `${byMarker}&status=closed`)).toEqual([
      c.id,
    ]);
    expect(
      (await listIds(bob.token, `${byMarker}&status=recruiting`)).sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it('编辑：标签移除后再加回复用软删行，非作者 403，停止后 409', async () => {
    const item = await createPost(alice, {
      title: `IT编辑_${RUN}`,
      content: '初稿',
      tagIds: [tag.internet.id, tag.software.id],
      recruitTotal: 3,
    });
    const postId = BigInt(item.id);
    const names = (post: PostItem) => post.tags.map((t) => t.name).sort();

    // 非作者 → 403，数据不变
    const forbidden = await api(bob.token)
      .put(`/posts/${item.id}`, { title: '篡改' })
      .expect(403);
    expect(envelope<null>(forbidden).code).toBe(403);
    expect(
      await prisma.communityPost.findUnique({ where: { id: postId } }),
    ).toMatchObject({
      title: `IT编辑_${RUN}`,
    });

    // 移除「互联网+」：关联行软删而不是物理删
    const removed = envelope<PostItem>(
      await api(alice.token)
        .put(`/posts/${item.id}`, { tagIds: [tag.software.id] })
        .expect(200),
    ).data!;
    expect(names(removed)).toEqual(['软件工程']);
    expect(
      await prisma.communityPostTag.findMany({
        where: { postId },
        select: { deleted: true },
      }),
    ).toHaveLength(2);

    // 加回「互联网+」：唯一键占位，必须恢复原行——直接 create 会撞 uk_community_post_tag
    const restored = envelope<PostItem>(
      await api(alice.token)
        .put(`/posts/${item.id}`, {
          title: `IT编辑改_${RUN}`,
          content: '二稿',
          tagIds: [tag.internet.id, tag.software.id],
          recruitTotal: 5,
        })
        .expect(200),
    ).data!;
    expect(restored).toMatchObject({
      title: `IT编辑改_${RUN}`,
      content: '二稿',
      recruitTotal: 5,
    });
    expect(names(restored)).toEqual(['互联网+', '软件工程']);
    const links = await prisma.communityPostTag.findMany({ where: { postId } });
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.deleted === 0)).toBe(true);

    // 已停止的帖子不可编辑
    await api(alice.token).post(`/posts/${item.id}/close`).expect(201);
    const closed = await api(alice.token)
      .put(`/posts/${item.id}`, { title: '再改' })
      .expect(409);
    expect(envelope<null>(closed).code).toBe(409);
  });

  it('停止招募：转「已停止」，重复停止 409，非作者 403', async () => {
    const item = await createPost(alice, {
      title: `IT停止_${RUN}`,
      tagIds: [tag.software.id],
    });

    await api(bob.token).post(`/posts/${item.id}/close`).expect(403);

    const closed = envelope<PostItem>(
      await api(alice.token).post(`/posts/${item.id}/close`).expect(201),
    ).data!;
    expect(closed.status).toBe('closed');

    const again = await api(alice.token)
      .post(`/posts/${item.id}/close`)
      .expect(409);
    expect(envelope<null>(again).code).toBe(409);

    // 已停止的帖子仍在广场可见（带状态），详情可读
    const listed = envelope<{ list: PostItem[] }>(
      await api(bob.token)
        .get(`/posts?q=${encodeURIComponent(`IT停止_${RUN}`)}`)
        .expect(200),
    ).data!;
    expect(listed.list.map((post) => post.status)).toEqual(['closed']);
    expect(
      envelope<PostItem>(
        await api(bob.token).get(`/posts/${item.id}`).expect(200),
      ).data!.status,
    ).toBe('closed');
  });

  it('删除：逻辑删除后列表与详情不可见、库内行仍在；非作者 403', async () => {
    const item = await createPost(alice, {
      title: `IT删除_${RUN}`,
      tagIds: [tag.software.id],
    });
    const byTitle = `q=${encodeURIComponent(`IT删除_${RUN}`)}`;

    await api(bob.token).del(`/posts/${item.id}`).expect(403);
    expect(await listIds(bob.token, byTitle)).toEqual([item.id]);

    await api(alice.token).del(`/posts/${item.id}`).expect(200);

    expect(await listIds(alice.token, byTitle)).toEqual([]);
    expect(await listIds(bob.token, `${byTitle}&mine=true`)).toEqual([]);
    const gone = await api(alice.token).get(`/posts/${item.id}`).expect(404);
    expect(envelope<null>(gone).message).toBe('帖子不存在');
    // 真库：行未被物理删除，仅 deleted 置 1
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(item.id) } }),
    ).toMatchObject({ deleted: 1 });
  });

  // ================================================================ 卡 E-2 申请与审批

  /** 社区模块之外的只读接口（课题组、通知中心） */
  function outside(token: string, path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** 某用户的通知列表（按 id 倒序） */
  async function noticesOf(user: User): Promise<NoticeRow[]> {
    const res = await outside(user.token, 'notifications?size=50').expect(200);
    return envelope<{ list: NoticeRow[] }>(res).data!.list;
  }

  async function detailOf(user: User, postId: string): Promise<PostItem> {
    const res = await api(user.token).get(`/posts/${postId}`).expect(200);
    return envelope<PostItem>(res).data!;
  }

  async function applyAs(
    user: User,
    postId: string,
    note = '',
  ): Promise<ApplicationRow> {
    const res = await api(user.token)
      .post(`/posts/${postId}/apply`, { note })
      .expect(201);
    return envelope<ApplicationRow>(res).data!;
  }

  /** 发帖人审批某条申请；不带状态断言，由调用方判断响应 */
  function handle(
    operator: User,
    applicationId: string,
    action: 'approve' | 'reject',
  ) {
    return api(operator.token).post(`/applications/${applicationId}/${action}`);
  }

  it('邀请码入组链：重复入组被拦且库内只有一行，无效邀请码 404', async () => {
    const server = app.getHttpServer();
    const created = envelope<{ id: string; inviteCode: string }>(
      await request(server)
        .post('/api/v1/teams')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ name: `IT邀请码组_${RUN}` })
        .expect(201),
    ).data!;
    const join = (user: User, inviteCode: string) =>
      request(server)
        .post('/api/v1/teams/join')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ inviteCode });

    await join(bob, created.inviteCode).expect(201);
    // 同一邀请码重复入组：service 查到已有成员，返回 409
    const again = await join(bob, created.inviteCode).expect(409);
    expect(envelope<null>(again).message).toBe('已在课题组中');
    // 绕过 service 直接重复写入：由 uk_team_member(team_id, user_id) 真实拦截
    await expect(
      prisma.teamMember.create({
        data: {
          teamId: BigInt(created.id),
          userId: BigInt(bob.userId),
          role: 'member',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.teamMember.count({
        where: { teamId: BigInt(created.id), userId: BigInt(bob.userId) },
      }),
    ).toBe(1);

    // 无效邀请码 404（邀请码没有有效期：表结构无对应列，按 docs/02 设计）；格式非法 400
    const invalid = await join(carol, 'ZZZZ9999').expect(404);
    expect(envelope<null>(invalid).message).toBe('邀请码无效');
    await join(carol, 'abc').expect(400);
  });

  it('申请 → 通知 → 审批通过 → 自动建组入组 → 进度 +1 全链路', async () => {
    const title = `IT闭环_${RUN}`;
    const post = await createPost(alice, {
      title,
      tagIds: [tag.software.id],
      recruitTotal: 2,
    });
    const postId = BigInt(post.id);

    // 申请人：提交申请说明
    const application = await applyAs(bob, post.id, '我会前端');
    expect(application).toMatchObject({
      postId: post.id,
      status: 'pending',
      note: '我会前端',
      handledAt: '',
      applicant: { id: bob.userId, nickname: `测试-${bob.username}` },
    });

    // 真库：申请落库；发帖人收到 team_apply 通知，跳转来源指向帖子
    expect(
      await prisma.teamApplication.count({
        where: { postId, userId: BigInt(bob.userId) },
      }),
    ).toBe(1);
    expect((await noticesOf(alice))[0]).toMatchObject({
      type: 'team_apply',
      title: `测试-${bob.username} 申请加入你的帖子《${title}》`,
      refType: 'community_post',
      refId: post.id,
      isRead: 0,
    });

    // 详情：申请人看到自己的申请状态；发帖人看到待处理数
    expect((await detailOf(bob, post.id)).myApplication).toMatchObject({
      id: application.id,
      status: 'pending',
    });
    expect(await detailOf(alice, post.id)).toMatchObject({
      pendingCount: 1,
      recruitedCount: 0,
      team: null,
    });
    const pending = envelope<{ list: ApplicationRow[] }>(
      await api(alice.token)
        .get(`/posts/${post.id}/applications?status=pending`)
        .expect(200),
    ).data!;
    expect(pending.list.map((row) => row.id)).toEqual([application.id]);

    // 通过：自动建组 + 入组 + 进度 +1
    const approved = envelope<HandleResult>(
      await handle(alice, application.id, 'approve').expect(201),
    ).data!;
    expect(approved.application).toMatchObject({
      id: application.id,
      status: 'approved',
    });
    expect(approved.post).toMatchObject({
      recruitedCount: 1,
      recruitTotal: 2,
      status: 'recruiting',
    });
    // 课题组名称 = 帖子标题；首次建组随响应给出邀请码
    const team = approved.post.team;
    if (!team) throw new Error('首次通过后帖子应已绑定课题组');
    expect(team.name).toBe(title);
    expect(approved.inviteCode).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);

    // 真库：课题组（发帖人为组长）、申请人入组、帖子绑定课题组
    const teamId = BigInt(team.id);
    expect(
      await prisma.team.findUnique({ where: { id: teamId } }),
    ).toMatchObject({
      name: title,
      ownerId: BigInt(alice.userId),
      inviteCode: approved.inviteCode,
    });
    const members = await prisma.teamMember.findMany({
      where: { teamId, deleted: 0 },
      select: { userId: true, role: true },
    });
    expect(members.map((m) => `${m.userId}:${m.role}`).sort()).toEqual(
      [`${alice.userId}:owner`, `${bob.userId}:member`].sort(),
    );
    expect(
      await prisma.communityPost.findUnique({ where: { id: postId } }),
    ).toMatchObject({ teamId, recruitedCount: 1, status: 'recruiting' });

    // 申请人收到通过通知；「我的课题组」里出现该组
    expect((await noticesOf(bob))[0]).toMatchObject({
      type: 'team_apply_approved',
      title: `测试-${alice.username} 通过了你加入《${title}》的申请`,
      refType: 'community_post',
      refId: post.id,
    });
    const myTeams = envelope<Array<{ id: string; role: string }>>(
      await outside(bob.token, 'teams/my').expect(200),
    ).data!;
    expect(myTeams).toContainEqual(
      expect.objectContaining({ id: team.id, role: 'member' }),
    );

    // 状态机不可逆：同一申请重复审批 → 409，进度不重复累加
    const repeat = await handle(alice, application.id, 'approve').expect(409);
    expect(envelope<null>(repeat).message).toBe('该申请已处理');
    expect(
      await prisma.communityPost.findUnique({ where: { id: postId } }),
    ).toMatchObject({ recruitedCount: 1 });
  });

  it('招满自动转「已满员」，后续申请被拒之门外', async () => {
    const title = `IT满员_${RUN}`;
    const post = await createPost(alice, {
      title,
      tagIds: [tag.modeling.id],
      recruitTotal: 1,
    });
    const application = await applyAs(carol, post.id);

    const approved = envelope<HandleResult>(
      await handle(alice, application.id, 'approve').expect(201),
    ).data!;
    expect(approved.post).toMatchObject({
      recruitedCount: 1,
      recruitTotal: 1,
      status: 'full',
    });
    // 真库：进度与状态同时落库
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(post.id) } }),
    ).toMatchObject({ recruitedCount: 1, status: 'full' });

    // 后来者：申请被拒之门外，且不落库
    const late = await api(dave.token)
      .post(`/posts/${post.id}/apply`, { note: '我也想来' })
      .expect(409);
    expect(envelope<null>(late).message).toBe('帖子已满员');
    expect(
      await prisma.teamApplication.count({
        where: { postId: BigInt(post.id), userId: BigInt(dave.userId) },
      }),
    ).toBe(0);

    // 广场与详情都显示「已满员」
    expect(await detailOf(dave, post.id)).toMatchObject({
      status: 'full',
      recruitedCount: 1,
      myApplication: null,
    });
    const listed = envelope<{ list: PostItem[] }>(
      await api(dave.token)
        .get(`/posts?q=${encodeURIComponent(title)}`)
        .expect(200),
    ).data!;
    expect(listed.list.map((item) => item.status)).toEqual(['full']);
  });

  it('非发帖人查看 / 审批申请 → 403，数据不受影响', async () => {
    const post = await createPost(alice, {
      title: `IT越权_${RUN}`,
      tagIds: [tag.innovation.id],
      recruitTotal: 1,
    });
    const application = await applyAs(bob, post.id);

    for (const res of [
      await api(bob.token).get(`/posts/${post.id}/applications`),
      await handle(bob, application.id, 'approve'),
      await handle(carol, application.id, 'reject'),
    ]) {
      expect(res.status).toBe(403);
      expect(envelope<null>(res).code).toBe(403);
    }
    // 真库：申请仍是待处理，帖子进度与课题组绑定都没动
    expect(
      await prisma.teamApplication.findUnique({
        where: { id: BigInt(application.id) },
      }),
    ).toMatchObject({ status: 'pending', handledBy: null });
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(post.id) } }),
    ).toMatchObject({ recruitedCount: 0, teamId: null });
    // 不存在的申请 → 404
    await handle(alice, '999999999', 'approve').expect(404);
  });

  it('并发审批不超招：只剩 1 个名额时两人同时被审批，恰好一人通过', async () => {
    const post = await createPost(alice, {
      title: `IT并发_${RUN}`,
      tagIds: [tag.internet.id],
      recruitTotal: 1,
    });
    const postId = BigInt(post.id);
    const [first, second] = await Promise.all([
      applyAs(bob, post.id),
      applyAs(carol, post.id),
    ]);

    // 两个审批请求同时发出，拿到各自的响应再判断
    const responses = await Promise.all(
      [first, second].map((row) => handle(alice, row.id, 'approve')),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);

    // 真库：进度恰为 1 且已满员；落败一方的申请仍是待处理（其事务已回滚）
    const row = await prisma.communityPost.findUnique({
      where: { id: postId },
    });
    expect(row).toMatchObject({
      recruitedCount: 1,
      recruitTotal: 1,
      status: 'full',
    });
    const applications = await prisma.teamApplication.findMany({
      where: { postId },
      orderBy: { id: 'asc' },
    });
    expect(applications.map((item) => item.status).sort()).toEqual([
      'approved',
      'pending',
    ]);
    // 课题组里只有发帖人与通过的那一位
    if (row?.teamId === null || row?.teamId === undefined) {
      throw new Error('已有人通过，帖子应已绑定课题组');
    }
    expect(
      await prisma.teamMember.count({ where: { teamId: row.teamId } }),
    ).toBe(2);

    const loser = responses.find((res) => res.status === 409);
    if (!loser) throw new Error('应恰有一个审批因名额不足被拒');
    expect(envelope<null>(loser).message).toBe('帖子已满员，无法再通过申请');
    // 落败的申请此时再审批仍是 409（已满员），但可以改为拒绝
    const loserId = applications.find((item) => item.status === 'pending');
    if (!loserId) throw new Error('落败申请应仍为待处理');
    await handle(alice, loserId.id.toString(), 'approve').expect(409);
    await handle(alice, loserId.id.toString(), 'reject').expect(201);
  });

  it('拒绝后不能再次申请同一帖：状态校验与唯一键双保险', async () => {
    const title = `IT拒绝_${RUN}`;
    const post = await createPost(alice, {
      title,
      tagIds: [tag.software.id],
      recruitTotal: 2,
    });
    const postId = BigInt(post.id);
    const application = await applyAs(bob, post.id);

    const rejected = envelope<HandleResult>(
      await handle(alice, application.id, 'reject').expect(201),
    ).data!;
    expect(rejected.application.status).toBe('rejected');
    // 拒绝不影响帖子：进度与课题组都不动
    expect(rejected.post).toEqual({
      recruitedCount: 0,
      recruitTotal: 2,
      status: 'recruiting',
      team: null,
    });
    expect((await noticesOf(bob))[0]).toMatchObject({
      type: 'team_apply_rejected',
      title: `测试-${alice.username} 拒绝了你加入《${title}》的申请`,
      refType: 'community_post',
      refId: post.id,
    });

    // 第一道保险：service 状态校验 → 409
    const again = await api(bob.token)
      .post(`/posts/${post.id}/apply`, { note: '再试试' })
      .expect(409);
    expect(envelope<null>(again).message).toBe('申请已被拒绝，不能再次申请');
    // 第二道保险：绕过 service 直接写入，由 uk_team_application(post_id, user_id) 拦截
    await expect(
      prisma.teamApplication.create({
        data: { postId, userId: BigInt(bob.userId), note: '' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.teamApplication.count({
        where: { postId, userId: BigInt(bob.userId) },
      }),
    ).toBe(1);
    // 详情里「已被拒绝」所依据的状态
    expect((await detailOf(bob, post.id)).myApplication).toMatchObject({
      id: application.id,
      status: 'rejected',
    });
  });

  it('停止招募后不再接新申请但可处理存量申请；有待处理申请时不能删帖', async () => {
    const title = `IT存量_${RUN}`;
    const post = await createPost(alice, {
      title,
      tagIds: [tag.modeling.id],
      recruitTotal: 2,
    });
    const application = await applyAs(bob, post.id);
    await api(alice.token).post(`/posts/${post.id}/close`).expect(201);

    // 新申请被拒之门外
    const late = await api(carol.token)
      .post(`/posts/${post.id}/apply`, {})
      .expect(409);
    expect(envelope<null>(late).message).toBe('帖子已停止招募');
    // 存量申请还没处理：不能删帖
    const blocked = await api(alice.token).del(`/posts/${post.id}`).expect(409);
    expect(envelope<null>(blocked).message).toBe(
      '还有 1 条待处理申请，请先处理后再删除',
    );
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(post.id) } }),
    ).toMatchObject({ deleted: 0 });

    // 存量申请仍可通过；帖子保持「已停止」
    const approved = envelope<HandleResult>(
      await handle(alice, application.id, 'approve').expect(201),
    ).data!;
    expect(approved.post).toMatchObject({
      recruitedCount: 1,
      status: 'closed',
    });

    // 处理完即可删帖；已组建的课题组不受影响
    const closedTeam = approved.post.team;
    if (!closedTeam) throw new Error('存量申请通过后帖子应已绑定课题组');
    await api(alice.token).del(`/posts/${post.id}`).expect(200);
    expect(
      await prisma.communityPost.findUnique({ where: { id: BigInt(post.id) } }),
    ).toMatchObject({ deleted: 1 });
    expect(
      await prisma.teamMember.count({
        where: { teamId: BigInt(closedTeam.id) },
      }),
    ).toBe(2);
    await api(bob.token).get(`/posts/${post.id}`).expect(404);
  });
});
