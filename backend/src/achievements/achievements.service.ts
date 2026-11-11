import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.constants';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import {
  listUserTeamIds,
  parseId,
  requireId,
  requireTeamMembership,
} from '../common/team-access';
import type {
  AchievementMemberDto,
  CreateAchievementDto,
} from './dto/achievement.dto';
import type { ListAchievementsQueryDto } from './dto/achievement-query.dto';

/** 成果成员条目 */
export interface AchievementMemberItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
  contributionNote: string;
}

/** 对外暴露的成果条目（列表与详情共用） */
export interface AchievementItem {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  title: string;
  description: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  /** 字节数，字符串形式（BIGINT 序列化约定） */
  fileSize: string;
  members: AchievementMemberItem[];
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

/** 参与人上限：组规模小，50 足够 */
const MAX_MEMBERS = 50;

/**
 * 成果服务（任务卡 C-3）。
 *
 * 约定：
 *   - 成果挂在项目下，权限校验走「项目所属团队的成员」（红线 9）；
 *   - 创建成果写 `achievement_submit`（创建者，权重 3.0）；
 *   - `achievement_member.contribution_note` 仅展示，**不参与任何计算**（红线 1）；
 *   - 删除成果**不撤销埋点**：成果表无 creator_id 无法定位创建者，
 *     且成果提交是真实发生过的，逻辑删除后保留历史埋点更合理。
 */
@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** 创建成果：同事务写 achievement + 成员 + 埋点 */
  async create(
    userId: string,
    dto: CreateAchievementDto,
  ): Promise<AchievementItem> {
    const project = await this.requireProject(dto.projectId, userId);
    const fileId = await this.resolveFileId(dto.fileId);
    const members = await this.validateMembers(dto.members, project.teamId);

    const achievement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.achievement.create({
        data: {
          projectId: project.id,
          type: dto.type,
          title: dto.title,
          description: dto.description || null,
          fileId,
        },
      });

      if (members.length > 0) {
        await tx.achievementMember.createMany({
          data: members.map((m) => ({
            achievementId: created.id,
            userId: m.userId,
            contributionNote: m.contributionNote ?? null,
          })),
        });
      }

      // achievement_submit：创建者一条，权重 3.0
      await this.activity.recordInTransaction(tx, {
        userId,
        teamId: project.teamId,
        type: ActivityType.ACHIEVEMENT_SUBMIT,
        refType: 'achievement',
        refId: created.id,
      });

      return created;
    });

    return this.detail(userId, toIdString(achievement.id));
  }

  /** 成果列表：分页，按项目过滤，仅返回本课题组可见的成果 */
  async list(
    userId: string,
    query: ListAchievementsQueryDto,
  ): Promise<PageData<AchievementItem>> {
    const teamIds = await listUserTeamIds(this.prisma, userId);
    const page = query.page ?? 1;
    const size = query.size ?? 10;
    if (teamIds.length === 0) {
      return { list: [], total: 0, page, size };
    }

    const where: Prisma.AchievementWhereInput = {
      deleted: 0,
      project: { teamId: { in: teamIds }, deleted: 0 },
    };
    if (query.projectId) {
      const projectId = parseId(query.projectId);
      where.projectId = projectId === null ? BigInt(-1) : projectId;
    }

    const [total, rows] = await Promise.all([
      this.prisma.achievement.count({ where }),
      this.prisma.achievement.findMany({
        where,
        include: {
          project: { select: { name: true } },
          file: {
            select: {
              originalName: true,
              url: true,
              size: true,
            },
          },
          members: {
            where: { deleted: 0 },
            include: {
              user: {
                select: {
                  username: true,
                  nickname: true,
                  avatar: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
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

  /** 成果详情 */
  async detail(userId: string, idParam: string): Promise<AchievementItem> {
    const { achievement } = await this.requireAchievement(idParam, userId);
    const row = await this.prisma.achievement.findFirst({
      where: { id: achievement.id, deleted: 0 },
      include: {
        project: { select: { name: true } },
        file: {
          select: {
            originalName: true,
            url: true,
            size: true,
          },
        },
        members: {
          where: { deleted: 0 },
          include: {
            user: {
              select: {
                username: true,
                nickname: true,
                avatar: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) {
      throw BizException.notFound('成果不存在');
    }
    return this.toItem(row);
  }

  /** 逻辑删除成果；不撤销历史埋点（见类注释） */
  async remove(userId: string, idParam: string): Promise<void> {
    const { achievement } = await this.requireAchievement(idParam, userId);
    await this.prisma.achievement.update({
      where: { id: achievement.id },
      data: { deleted: 1 },
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 取成果并校验访问权限（红线 9） */
  private async requireAchievement(idParam: string, userId: string) {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('成果不存在');
    }
    const achievement = await this.prisma.achievement.findFirst({
      where: { id, deleted: 0 },
    });
    if (!achievement) {
      throw BizException.notFound('成果不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: achievement.projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('成果不存在');
    }
    await requireTeamMembership(this.prisma, project.teamId, userId);
    return { achievement, project };
  }

  /** 取项目并校验访问权限（成果创建时的入口） */
  private async requireProject(projectIdParam: string, userId: string) {
    const projectId = parseId(projectIdParam);
    if (projectId === null) {
      throw BizException.notFound('项目不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('项目不存在');
    }
    await requireTeamMembership(this.prisma, project.teamId, userId);
    return project;
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
   * 校验成员：必须是本课题组成员，去重，最多 MAX_MEMBERS 人。
   * 返回去重后的列表，保留原顺序。
   */
  private async validateMembers(
    members: AchievementMemberDto[] | undefined,
    teamId: bigint,
  ): Promise<{ userId: bigint; contributionNote: string | null }[]> {
    if (!members || members.length === 0) {
      return [];
    }
    const seen = new Set<string>();
    const result: { userId: bigint; contributionNote: string | null }[] = [];
    for (const raw of members) {
      const id = requireId(raw.userId, 'members 含非法 userId');
      const key = id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        userId: id,
        contributionNote: raw.contributionNote || null,
      });
    }
    if (result.length > MAX_MEMBERS) {
      throw BizException.param(`参与人最多 ${MAX_MEMBERS} 人`);
    }
    // 校验都是本组成员
    const valid = await this.prisma.teamMember.findMany({
      where: {
        teamId,
        userId: { in: result.map((m) => m.userId) },
        deleted: 0,
      },
      select: { userId: true },
    });
    const validSet = new Set(valid.map((m) => m.userId.toString()));
    for (const m of result) {
      if (!validSet.has(m.userId.toString())) {
        throw BizException.param('参与人必须是本课题组成员');
      }
    }
    return result;
  }

  private toItem(row: {
    id: bigint;
    projectId: bigint;
    type: string;
    title: string;
    description: string | null;
    fileId: bigint | null;
    createdAt: Date;
    updatedAt: Date;
    project: { name: string };
    file: { originalName: string; url: string | null; size: bigint } | null;
    members: {
      userId: bigint;
      contributionNote: string | null;
      user: {
        username: string;
        nickname: string;
        avatar: string;
        email: string;
      };
    }[];
  }): AchievementItem {
    return {
      id: toIdString(row.id),
      projectId: toIdString(row.projectId),
      projectName: row.project.name,
      type: row.type,
      title: row.title,
      description: row.description ?? '',
      fileId: row.fileId === null ? '' : toIdString(row.fileId),
      fileName: row.file?.originalName ?? '',
      fileUrl: row.file?.url ?? '',
      fileSize: row.file ? row.file.size.toString() : '',
      members: row.members.map((m) => ({
        userId: toIdString(m.userId),
        username: m.user.username,
        nickname: m.user.nickname,
        avatar: m.user.avatar,
        email: m.user.email,
        contributionNote: m.contributionNote ?? '',
      })),
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}
