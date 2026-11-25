import { Injectable } from '@nestjs/common';
import type { Prisma, TeamApplication } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { RECRUIT_TOTAL_MIN } from './community.constants';
import { requirePostAuthor, requireVisiblePost } from './post-access';
import type { CreatePostDto, UpdatePostDto } from './dto/post.dto';
import type { ListPostsQueryDto } from './dto/list-posts.query';

/** 标签条目（字典与帖子内嵌共用） */
export interface CommunityTagItem {
  id: string;
  name: string;
  /** competition 竞赛 / course 课程 */
  category: string;
}

/** 发布人卡片：社区是跨组公开内容，只给昵称与头像，不带登录名和邮箱 */
export interface PostAuthor {
  id: string;
  nickname: string;
  avatar: string;
}

/** 当前用户在该帖的申请（卡 E-2）：决定「申请加入」按钮的状态 */
export interface MyApplicationItem {
  id: string;
  /** pending 待处理 / approved 已通过 / rejected 已拒绝 */
  status: string;
  note: string;
  createdAt: string;
  /** 未处理时为空字符串 */
  handledAt: string;
}

/** 帖子结构（发布、编辑、列表项、详情同构，见 docs/01「组队广场」） */
export interface CommunityPostItem {
  id: string;
  title: string;
  /** 无说明时为空字符串 */
  content: string;
  recruitTotal: number;
  recruitedCount: number;
  status: string;
  tags: CommunityTagItem[];
  author: PostAuthor;
  /** 审批通过后绑定的课题组（卡 E-2），未绑定为 null */
  team: { id: string; name: string } | null;
  /** 当前用户是否发帖人 */
  isAuthor: boolean;
  /** 当前用户在该帖的申请，未申请为 null */
  myApplication: MyApplicationItem | null;
  /** 待处理申请数：只对发帖人统计，其他人恒为 0 */
  pendingCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 分页返回结构（docs/01 第四节） */
export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

type PostWithRelations = Prisma.CommunityPostGetPayload<{
  include: typeof POST_INCLUDE;
}>;

/** 列表与详情统一带出的关系：发布人、绑定课题组、未删除的标签 */
const POST_INCLUDE = {
  author: { select: { id: true, nickname: true, avatar: true } },
  team: { select: { id: true, name: true } },
  tags: {
    where: { deleted: 0 },
    orderBy: { tagId: 'asc' as const },
    select: { tag: { select: { id: true, name: true, category: true } } },
  },
} satisfies Prisma.CommunityPostInclude;

/**
 * 组队帖子服务（任务卡 E-1 / E-2，线②）。
 *
 * 约定：
 *   - 社区是平台第一个跨组公开内容：广场对全站登录用户可见，
 *     编辑 / 停止 / 删除的权限在 service 层按「作者本人」判断（不信 JWT roles）；
 *   - 所有查询显式带 deleted: 0（红线 5）；
 *   - 发帖不写埋点：activity_log.team_id 非空而发帖时尚无课题组，无法归属（docs/01）。
 */
@Injectable()
export class CommunityPostsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 发布：校验标签 → 同一事务写入帖子与标签关联 */
  async create(userId: string, dto: CreatePostDto): Promise<CommunityPostItem> {
    const tagIds = await this.resolveTagIds(dto.tagIds);
    const postId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityPost.create({
        data: {
          userId: BigInt(userId),
          title: dto.title,
          content: dto.content ?? '',
          recruitTotal: dto.recruitTotal ?? RECRUIT_TOTAL_MIN,
        },
        select: { id: true },
      });
      if (tagIds.length > 0) {
        await tx.communityPostTag.createMany({
          data: tagIds.map((tagId) => ({ postId: created.id, tagId })),
        });
      }
      return created.id;
    });
    return this.requireItem(postId, userId);
  }

  /** 广场列表：按 id 倒序，支持标签（命中任一）/ 关键词 / 状态 / 只看我的 */
  async list(
    userId: string,
    query: ListPostsQueryDto,
  ): Promise<PageData<CommunityPostItem>> {
    const page = query.page ?? 1;
    const size = query.size ?? 10;
    const where: Prisma.CommunityPostWhereInput = { deleted: 0 };
    if (query.status) {
      where.status = query.status;
    }
    if (query.mine) {
      where.userId = BigInt(userId);
    }
    if (query.tags && query.tags.length > 0) {
      where.tags = {
        some: {
          tagId: { in: query.tags.map((id) => BigInt(id)) },
          deleted: 0,
        },
      };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q } },
        { content: { contains: query.q } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.communityPost.count({ where }),
      this.prisma.communityPost.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return {
      list: await this.toItems(rows, userId),
      total,
      page,
      size,
    };
  }

  /** 帖子详情：全站登录用户可见，已删除按 404 处理 */
  async detail(userId: string, idParam: string): Promise<CommunityPostItem> {
    const post = await requireVisiblePost(this.prisma, idParam);
    return this.requireItem(post.id, userId);
  }

  /** 编辑：仅发帖人、仅「招募中」；标签按传入集合整体同步 */
  async update(
    userId: string,
    idParam: string,
    dto: UpdatePostDto,
  ): Promise<CommunityPostItem> {
    if (
      dto.title === undefined &&
      dto.content === undefined &&
      dto.tagIds === undefined &&
      dto.recruitTotal === undefined
    ) {
      throw BizException.param('请至少提供要修改的字段');
    }
    const post = await requireVisiblePost(this.prisma, idParam);
    requirePostAuthor(post, userId);
    if (post.status !== 'recruiting') {
      throw BizException.conflict('帖子已停止招募或已满员，不可编辑');
    }
    if (
      dto.recruitTotal !== undefined &&
      dto.recruitTotal <= post.recruitedCount
    ) {
      throw BizException.param('招募人数需大于已招人数（至少留 1 个名额）');
    }
    const tagIds =
      dto.tagIds !== undefined ? await this.resolveTagIds(dto.tagIds) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.communityPost.update({
        where: { id: post.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.recruitTotal !== undefined
            ? { recruitTotal: dto.recruitTotal }
            : {}),
        },
      });
      if (tagIds !== null) {
        await this.syncTags(tx, post.id, tagIds);
      }
    });
    return this.requireItem(post.id, userId);
  }

  /** 停止招募：仅发帖人；招募中 / 已满员均可转入「已停止」，终态不可重复 */
  async close(userId: string, idParam: string): Promise<CommunityPostItem> {
    const post = await requireVisiblePost(this.prisma, idParam);
    requirePostAuthor(post, userId);
    if (post.status === 'closed') {
      throw BizException.conflict('帖子已停止招募');
    }
    await this.prisma.communityPost.update({
      where: { id: post.id },
      data: { status: 'closed' },
    });
    return this.requireItem(post.id, userId);
  }

  /**
   * 逻辑删除：广场与详情立即不可见，已组建的课题组不受影响。
   * 还有待处理申请时不允许删除（409）——否则申请人的申请随帖子一起无处可查、永远等不到结果；
   * 只想停止接新申请应使用「停止招募」。
   */
  async remove(userId: string, idParam: string): Promise<void> {
    const post = await requireVisiblePost(this.prisma, idParam);
    requirePostAuthor(post, userId);
    const pending = await this.prisma.teamApplication.count({
      where: { postId: post.id, status: 'pending', deleted: 0 },
    });
    if (pending > 0) {
      throw BizException.conflict(
        `还有 ${pending} 条待处理申请，请先处理后再删除`,
      );
    }
    await this.prisma.communityPost.update({
      where: { id: post.id },
      data: { deleted: 1 },
    });
  }

  /** 标签字典：先竞赛后课程，同类别按 id 升序 */
  async listTags(): Promise<CommunityTagItem[]> {
    const rows = await this.prisma.communityTag.findMany({
      where: { deleted: 0 },
      orderBy: [{ category: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: toIdString(row.id),
      name: row.name,
      category: row.category,
    }));
  }

  // ---------------------------------------------------------------- 内部

  /** 校验标签全部在字典内且未删除；按数值去重后返回（"1" 与 "01" 视为同一标签） */
  private async resolveTagIds(tagIds: string[]): Promise<bigint[]> {
    const ids = [...new Set(tagIds.map((id) => BigInt(id)))];
    const found = await this.prisma.communityTag.findMany({
      where: { id: { in: ids }, deleted: 0 },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw BizException.param('所选标签不存在');
    }
    return ids;
  }

  /**
   * 同步标签关联（照 literatures 的 syncTags 模式）。
   *
   * uk_community_post_tag(post_id, tag_id) 不过滤软删行，已存在的关联必须
   * update 恢复或标记删除，不能直接 create。
   */
  private async syncTags(
    tx: Prisma.TransactionClient,
    postId: bigint,
    tagIds: bigint[],
  ): Promise<void> {
    const wanted = new Set(tagIds.map((id) => id.toString()));
    const existing = await tx.communityPostTag.findMany({
      where: { postId },
      select: { id: true, tagId: true, deleted: true },
    });
    const existingByTag = new Map(
      existing.map((row) => [row.tagId.toString(), row]),
    );

    for (const row of existing) {
      if (row.deleted === 0 && !wanted.has(row.tagId.toString())) {
        await tx.communityPostTag.update({
          where: { id: row.id },
          data: { deleted: 1 },
        });
      }
    }
    for (const tagId of tagIds) {
      const row = existingByTag.get(tagId.toString());
      if (!row) {
        await tx.communityPostTag.create({ data: { postId, tagId } });
      } else if (row.deleted === 1) {
        await tx.communityPostTag.update({
          where: { id: row.id },
          data: { deleted: 0 },
        });
      }
    }
  }

  /** 按完整关系回读一条帖子（写操作后的返回值） */
  private async requireItem(
    postId: bigint,
    userId: string,
  ): Promise<CommunityPostItem> {
    const row = await this.prisma.communityPost.findFirst({
      where: { id: postId, deleted: 0 },
      include: POST_INCLUDE,
    });
    // 刚写入的行随即回读，缺失只可能来自并发删除；按 404 兜底
    if (!row) {
      throw BizException.notFound('帖子不存在');
    }
    return (await this.toItems([row], userId))[0];
  }

  /**
   * 补上与当前用户相关的两个字段（卡 E-2），两次批量查询，不逐帖查库：
   *   - myApplication：当前用户在各帖的申请（每人每帖至多一条，唯一键保证）；
   *   - pendingCount：待处理申请数，只统计当前用户自己发的帖子。
   */
  private async toItems(
    rows: PostWithRelations[],
    userId: string,
  ): Promise<CommunityPostItem[]> {
    if (rows.length === 0) {
      return [];
    }
    const viewerId = BigInt(userId);
    const ownIds = rows.filter((row) => row.userId === viewerId);
    const [applications, pending] = await Promise.all([
      this.prisma.teamApplication.findMany({
        where: {
          userId: viewerId,
          postId: { in: rows.map((row) => row.id) },
          deleted: 0,
        },
      }),
      ownIds.length > 0
        ? this.prisma.teamApplication.groupBy({
            by: ['postId'],
            where: {
              postId: { in: ownIds.map((row) => row.id) },
              status: 'pending',
              deleted: 0,
            },
            _count: { _all: true },
          })
        : [],
    ]);
    const mine = new Map(
      applications.map((row) => [row.postId.toString(), row]),
    );
    const pendingByPost = new Map(
      pending.map((row) => [row.postId.toString(), row._count._all]),
    );

    return rows.map((row) =>
      this.toItem(
        row,
        viewerId,
        mine.get(row.id.toString()) ?? null,
        row.userId === viewerId
          ? (pendingByPost.get(row.id.toString()) ?? 0)
          : 0,
      ),
    );
  }

  private toItem(
    row: PostWithRelations,
    viewerId: bigint,
    myApplication: TeamApplication | null,
    pendingCount: number,
  ): CommunityPostItem {
    return {
      id: toIdString(row.id),
      title: row.title,
      content: row.content ?? '',
      recruitTotal: row.recruitTotal,
      recruitedCount: row.recruitedCount,
      status: row.status,
      tags: row.tags.map(({ tag }) => ({
        id: toIdString(tag.id),
        name: tag.name,
        category: tag.category,
      })),
      author: {
        id: toIdString(row.author.id),
        nickname: row.author.nickname,
        avatar: row.author.avatar,
      },
      team: row.team
        ? { id: toIdString(row.team.id), name: row.team.name }
        : null,
      isAuthor: row.userId === viewerId,
      myApplication: myApplication
        ? {
            id: toIdString(myApplication.id),
            status: myApplication.status,
            note: myApplication.note,
            createdAt: formatDateTime(myApplication.createdAt),
            handledAt: formatDateTime(myApplication.handledAt),
          }
        : null,
      pendingCount,
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}
