/**
 * 组队广场真库集成（线②，卡 E-1 帖子与标签）。
 *
 * 真库验证点（mock 单测覆盖不到的）：
 *   - uk_community_post_tag(post_id, tag_id) 不过滤软删行：标签移除后再加回必须复用原行，
 *     直接 create 会撞唯一键；
 *   - 逻辑删除过滤真实生效：删帖后列表与详情不可见，行仍在库中；
 *   - 筛选 SQL 行为：多标签 some + in、关键词匹配标题或正文、分页的 count 与 list 一致。
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
      post: (path: string, body?: unknown) =>
        auth(request(server).post(`/api/v1/community${path}`)).send(body),
      put: (path: string, body?: unknown) =>
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

  /** 物理清理本套件产生的数据（外键依赖顺序：关联 → 帖子 → 用户） */
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
    await prisma.communityPostTag.deleteMany({
      where: { postId: { in: postIds } },
    });
    await prisma.communityPost.deleteMany({ where: { id: { in: postIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    await purge();
    alice = await registerUser(app, `${PREFIX}a_${RUN}`);
    bob = await registerUser(app, `${PREFIX}b_${RUN}`);

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
});
