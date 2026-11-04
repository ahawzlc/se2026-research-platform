import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import {
  ACTIVITY_DAILY_LIMIT,
  ActivityType,
  type ActivityTypeValue,
} from '../activity/activity.constants';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import {
  listUserTeamIds,
  parseId,
  requireId,
  requireTeamMembership,
} from '../common/team-access';
import type {
  CreateLiteratureDto,
  ReadStatus,
  UpdateLiteratureDto,
  UpdateReadStatusDto,
} from './dto/literature.dto';
import type { ListLiteraturesQueryDto } from './dto/literature-query.dto';

/** 对外暴露的文献条目（列表与详情共用同一结构） */
export interface LiteratureItem {
  id: string;
  teamId: string;
  projectId: string;
  title: string;
  sourceUrl: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  /** 字节数，字符串形式（BIGINT 序列化约定） */
  fileSize: string;
  readStatus: string;
  uploaderId: string;
  uploaderName: string;
  tags: string[];
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

/** 查询时 include 的关系形状，便于 toItem 做类型约束 */
interface LiteratureWithRelations {
  id: bigint;
  teamId: bigint;
  projectId: bigint | null;
  title: string;
  sourceUrl: string | null;
  fileId: bigint | null;
  readStatus: string;
  uploaderId: bigint;
  createdAt: Date;
  updatedAt: Date;
  deleted: number;
  file: {
    originalName: string;
    url: string | null;
    size: bigint;
    mimeType: string | null;
  } | null;
  tags: { tag: string }[];
  uploader: { username: string; nickname: string };
}

/**
 * 文献服务（任务卡 C-1）。
 *
 * 约定：
 *   - 列表只返回当前用户所在课题组的文献（红线 9）；
 *   - 创建文献写 `literature_upload`（单日上限 5 条）；
 *   - 阅读状态变为 `read` 时写 `literature_read`（同一文献只计一次，单日上限 5 条），
 *     从 `read` 退回时撤销该条埋点；
 *   - 附件上传本身（C-4）不写埋点，由本模块在创建文献时统一记账。
 */
@Injectable()
export class LiteraturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** 创建文献：校验 → 同事务写 literature + 标签 + 埋点 */
  async create(
    userId: string,
    dto: CreateLiteratureDto,
  ): Promise<LiteratureItem> {
    const teamId = await this.resolveTeamId(userId, dto.teamId);
    await requireTeamMembership(this.prisma, teamId, userId);

    const projectId = await this.resolveProjectId(dto.projectId, teamId);
    const fileId = await this.resolveFileId(dto.fileId);
    if (!fileId && !dto.sourceUrl) {
      throw BizException.param('附件与外链至少提供一个');
    }

    const readStatus: ReadStatus = dto.readStatus ?? 'unread';

    const created = await this.prisma.$transaction(async (tx) => {
      const literature = await tx.literature.create({
        data: {
          teamId,
          projectId,
          title: dto.title,
          sourceUrl: dto.sourceUrl || null,
          fileId,
          readStatus,
          uploaderId: BigInt(userId),
        },
      });

      if (dto.tags?.length) {
        await this.syncTags(tx, literature.id, dto.tags);
      }

      // literature_upload 埋点（单日上限 5 条）
      if (
        await this.isWithinDailyLimit(
          tx,
          userId,
          ActivityType.LITERATURE_UPLOAD,
        )
      ) {
        await this.activity.recordInTransaction(tx, {
          userId,
          teamId,
          type: ActivityType.LITERATURE_UPLOAD,
          refType: 'literature',
          refId: literature.id,
        });
      }

      // 创建时直接标记为已读，也记一次阅读
      if (readStatus === 'read') {
        if (
          await this.isWithinDailyLimit(
            tx,
            userId,
            ActivityType.LITERATURE_READ,
          )
        ) {
          await this.activity.recordOnce(tx, {
            userId,
            teamId,
            type: ActivityType.LITERATURE_READ,
            refType: 'literature',
            refId: literature.id,
          });
        }
      }

      return literature;
    });

    return this.detail(userId, toIdString(created.id));
  }

  /** 文献列表：分页 + 过滤，仅返回本课题组可见的文献 */
  async list(
    userId: string,
    query: ListLiteraturesQueryDto,
  ): Promise<PageData<LiteratureItem>> {
    const teamIds = await listUserTeamIds(this.prisma, userId);
    const page = query.page ?? 1;
    const size = query.size ?? 10;
    if (teamIds.length === 0) {
      return { list: [], total: 0, page, size };
    }

    const where: Prisma.LiteratureWhereInput = {
      teamId: { in: teamIds },
      deleted: 0,
    };
    if (query.teamId) {
      const teamId = parseId(query.teamId);
      if (teamId === null || !teamIds.includes(teamId)) {
        return { list: [], total: 0, page, size };
      }
      where.teamId = teamId;
    }
    if (query.projectId) {
      const projectId = parseId(query.projectId);
      where.projectId = projectId === null ? BigInt(-1) : projectId;
    }
    if (query.readStatus) {
      where.readStatus = query.readStatus;
    }
    if (query.tag) {
      where.tags = { some: { tag: query.tag, deleted: 0 } };
    }
    if (query.keyword) {
      where.title = { contains: query.keyword };
    }

    const [total, rows] = await Promise.all([
      this.prisma.literature.count({ where }),
      this.prisma.literature.findMany({
        where,
        include: {
          file: {
            select: {
              originalName: true,
              url: true,
              size: true,
              mimeType: true,
            },
          },
          tags: { where: { deleted: 0 }, select: { tag: true } },
          uploader: { select: { username: true, nickname: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    return {
      list: rows.map((row) => this.toItem(row)),
      total,
      page,
      size,
    };
  }

  /** 文献详情 */
  async detail(userId: string, idParam: string): Promise<LiteratureItem> {
    const literature = await this.requireLiterature(idParam, userId);
    const row = await this.prisma.literature.findFirst({
      where: { id: literature.id, deleted: 0 },
      include: {
        file: {
          select: {
            originalName: true,
            url: true,
            size: true,
            mimeType: true,
          },
        },
        tags: { where: { deleted: 0 }, select: { tag: true } },
        uploader: { select: { username: true, nickname: true } },
      },
    });
    if (!row) {
      throw BizException.notFound('文献不存在');
    }
    return this.toItem(row);
  }

  /** 更新文献基本信息（不含阅读状态） */
  async update(
    userId: string,
    idParam: string,
    dto: UpdateLiteratureDto,
  ): Promise<LiteratureItem> {
    const literature = await this.requireLiterature(idParam, userId);

    const nextProjectId =
      dto.projectId === undefined
        ? literature.projectId
        : dto.projectId === ''
          ? null
          : await this.resolveProjectId(dto.projectId, literature.teamId);

    const nextFileId =
      dto.fileId === undefined
        ? literature.fileId
        : dto.fileId === ''
          ? null
          : await this.resolveFileId(dto.fileId);

    const nextSourceUrl =
      dto.sourceUrl === undefined
        ? literature.sourceUrl
        : dto.sourceUrl === ''
          ? null
          : dto.sourceUrl;

    if (!nextFileId && !nextSourceUrl) {
      throw BizException.param('附件与外链至少保留一个');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.literature.update({
        where: { id: literature.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.projectId !== undefined ? { projectId: nextProjectId } : {}),
          ...(dto.fileId !== undefined ? { fileId: nextFileId } : {}),
          ...(dto.sourceUrl !== undefined ? { sourceUrl: nextSourceUrl } : {}),
        },
      });
      if (dto.tags !== undefined) {
        await this.syncTags(tx, literature.id, dto.tags);
      }
    });

    return this.detail(userId, idParam);
  }

  /** 逻辑删除文献 */
  async remove(userId: string, idParam: string): Promise<void> {
    const literature = await this.requireLiterature(idParam, userId);
    await this.prisma.literature.update({
      where: { id: literature.id },
      data: { deleted: 1 },
    });
  }

  /**
   * 更新阅读状态。
   *
   * 埋点口径（docs/03 第六节反刷分）：
   *   - 非 read → read：写 `literature_read`，`recordOnce` 保证同一文献只计一次；
   *   - read → 非 read：撤销该条埋点（权重置 0）；
   *   - 单日上限 5 条，超出后仍可改状态，只是不再计入。
   */
  async updateReadStatus(
    userId: string,
    idParam: string,
    dto: UpdateReadStatusDto,
  ): Promise<LiteratureItem> {
    const literature = await this.requireLiterature(idParam, userId);
    if (literature.readStatus === dto.readStatus) {
      return this.detail(userId, idParam);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.literature.update({
        where: { id: literature.id },
        data: { readStatus: dto.readStatus },
      });

      if (dto.readStatus === 'read') {
        if (
          await this.isWithinDailyLimit(
            tx,
            userId,
            ActivityType.LITERATURE_READ,
          )
        ) {
          await this.activity.recordOnce(tx, {
            userId,
            teamId: literature.teamId,
            type: ActivityType.LITERATURE_READ,
            refType: 'literature',
            refId: literature.id,
          });
        }
      } else if (literature.readStatus === 'read') {
        await this.activity.revoke(tx, {
          userId,
          type: ActivityType.LITERATURE_READ,
          refType: 'literature',
          refId: literature.id,
        });
      }
    });

    return this.detail(userId, idParam);
  }

  // ---------------------------------------------------------------- 内部

  /** 取文献并校验团队访问权限（红线 9） */
  private async requireLiterature(idParam: string, userId: string) {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('文献不存在');
    }
    const literature = await this.prisma.literature.findFirst({
      where: { id, deleted: 0 },
    });
    if (!literature) {
      throw BizException.notFound('文献不存在');
    }
    await requireTeamMembership(this.prisma, literature.teamId, userId);
    return literature;
  }

  /** 确定文献归属的课题组：显式传 teamId 时校验成员身份；未传时取第一个课题组 */
  private async resolveTeamId(
    userId: string,
    teamIdParam?: string,
  ): Promise<bigint> {
    if (teamIdParam) {
      const teamId = requireId(teamIdParam, 'teamId 非法');
      return teamId;
    }
    const teamIds = await listUserTeamIds(this.prisma, userId);
    const first = teamIds[0];
    if (first === undefined) {
      throw BizException.param('请先创建或加入课题组');
    }
    return first;
  }

  /** 校验项目属于该课题组 */
  private async resolveProjectId(
    projectIdParam: string | undefined,
    teamId: bigint,
  ): Promise<bigint | null> {
    if (!projectIdParam) {
      return null;
    }
    const projectId = requireId(projectIdParam, 'projectId 非法');
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, teamId, deleted: 0 },
      select: { id: true },
    });
    if (!project) {
      throw BizException.param('项目不存在或不属于该课题组');
    }
    return projectId;
  }

  /** 校验附件存在 */
  private async resolveFileId(
    fileIdParam: string | undefined,
  ): Promise<bigint | null> {
    if (!fileIdParam) {
      return null;
    }
    const fileId = requireId(fileIdParam, 'fileId 非法');
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, deleted: 0 },
      select: { id: true },
    });
    if (!file) {
      throw BizException.param('附件不存在');
    }
    return fileId;
  }

  /**
   * 同步标签。
   *
   * `uk_literature_tag(literature_id, tag)` 唯一索引不过滤软删行，
   * 因此已存在的标签必须 update 恢复，不能直接 create。
   */
  private async syncTags(
    tx: Prisma.TransactionClient,
    literatureId: bigint,
    tags: string[],
  ): Promise<void> {
    const uniqueTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    const existing = await tx.literatureTag.findMany({
      where: { literatureId },
      select: { id: true, tag: true, deleted: true },
    });
    const existingMap = new Map(existing.map((row) => [row.tag, row]));

    for (const row of existing) {
      if (row.deleted === 0 && !uniqueTags.includes(row.tag)) {
        await tx.literatureTag.update({
          where: { id: row.id },
          data: { deleted: 1 },
        });
      }
    }

    for (const tag of uniqueTags) {
      const row = existingMap.get(tag);
      if (row) {
        if (row.deleted === 1) {
          await tx.literatureTag.update({
            where: { id: row.id },
            data: { deleted: 0 },
          });
        }
      } else {
        await tx.literatureTag.create({ data: { literatureId, tag } });
      }
    }
  }

  /**
   * 判断该用户当日某类埋点是否还在单日上限内。
   *
   * 统计口径与 docs/03 第六节一致；撤销的埋点（weight=0）不占额度。
   */
  private async isWithinDailyLimit(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    type: ActivityTypeValue,
  ): Promise<boolean> {
    const limit = ACTIVITY_DAILY_LIMIT[type];
    if (limit === undefined) {
      return true;
    }
    const startOfDay = startOfUtcDay(new Date());
    const count = await client.activityLog.count({
      where: {
        userId: BigInt(userId),
        type,
        createdAt: { gte: startOfDay },
        weight: { gt: 0 },
      },
    });
    return count < limit;
  }

  private toItem(row: LiteratureWithRelations): LiteratureItem {
    return {
      id: toIdString(row.id),
      teamId: toIdString(row.teamId),
      projectId: row.projectId === null ? '' : toIdString(row.projectId),
      title: row.title,
      sourceUrl: row.sourceUrl ?? '',
      fileId: row.fileId === null ? '' : toIdString(row.fileId),
      fileName: row.file?.originalName ?? '',
      fileUrl: row.file?.url ?? '',
      fileSize: row.file ? row.file.size.toString() : '',
      readStatus: row.readStatus,
      uploaderId: toIdString(row.uploaderId),
      uploaderName: row.uploader.nickname || row.uploader.username,
      tags: row.tags.map((t) => t.tag),
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}

/** 取「今日零点」：库内统一存 UTC，单日上限按 UTC 日界切分 */
function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
