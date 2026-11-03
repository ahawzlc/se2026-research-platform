import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDate, formatDateTime, toIdString } from '../common/datetime';
import {
  listUserTeamIds,
  parseId,
  requireTeamMembership,
} from '../common/team-access';
import type { CreateProjectDto } from './dto/project.dto';
import type { UpdateProjectDto } from './dto/project.dto';
import type { ListProjectsQueryDto } from './dto/project-query.dto';

/** 对外暴露的项目条目 */
export interface ProjectItem {
  id: string;
  teamId: string;
  name: string;
  description: string;
  status: string;
  startDate: string;
  endDate: string;
  /** 项目成员数，前端展示用 */
  memberCount: number;
  /** 里程碑统计：总数与已完成数 */
  milestoneTotal: number;
  milestoneDone: number;
  /** 任务统计：三列各自数量，看板与概览页都要用 */
  taskTotal: number;
  taskTodo: number;
  taskDoing: number;
  taskDone: number;
  createdAt: string;
}

/** 项目详情：在列表条目基础上附成员列表 */
export interface ProjectDetail extends ProjectItem {
  members: ProjectMemberItem[];
}

/** 项目成员条目 */
export interface ProjectMemberItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
  joinedAt: string;
}

/** 分页返回结构（docs/01 第四节） */
export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

/**
 * 项目服务（任务卡 B-1）。
 *
 * 约定：
 *   - 列表只返回当前用户所在课题组的项目（红线 9）；
 *   - 项目与成员、里程碑、任务的统计在同一次查询里聚合，避免 N+1；
 *   - 项目删除是逻辑删除（deleted=1），其下任务、里程碑不做级联，由应用层按需判断。
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 项目列表：分页 + 状态筛选 + 名称模糊匹配 */
  async list(
    userId: string,
    query: ListProjectsQueryDto,
  ): Promise<PageData<ProjectItem>> {
    const teamIds = await listUserTeamIds(this.prisma, userId);
    // 用户还没加入任何课题组时返回空列表（而不是报错），前端好渲染空状态
    if (teamIds.length === 0) {
      return {
        list: [],
        total: 0,
        page: query.page ?? 1,
        size: query.size ?? 10,
      };
    }

    const where: Prisma.ProjectWhereInput = {
      teamId: { in: teamIds },
      deleted: 0,
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.keyword) {
      where.name = { contains: query.keyword };
    }

    const page = query.page ?? 1;
    const size = query.size ?? 10;
    const [total, rows] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    const items = await Promise.all(
      rows.map((row) => this.toProjectItem(row.id)),
    );
    return { list: items, total, page, size };
  }

  /** 项目详情：附成员列表 */
  async detail(userId: string, projectIdParam: string): Promise<ProjectDetail> {
    const project = await this.requireProject(projectIdParam, userId);
    const [item, members] = await Promise.all([
      this.toProjectItem(project.id),
      this.listMembersById(project.id),
    ]);
    return { ...item, members };
  }

  /** 创建项目：默认把创建者加为项目成员 */
  async create(userId: string, dto: CreateProjectDto): Promise<ProjectItem> {
    const teamId = await this.resolveTeamId(userId, dto.teamId);
    await requireTeamMembership(this.prisma, teamId, userId);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          teamId,
          name: dto.name,
          description: dto.description ?? '',
          status: dto.status ?? 'planning',
          startDate: dto.startDate ? toDate(dto.startDate) : null,
          endDate: dto.endDate ? toDate(dto.endDate) : null,
        },
      });
      await tx.projectMember.create({
        data: { projectId: created.id, userId: BigInt(userId) },
      });
      return created;
    });
    return this.toProjectItem(project.id);
  }

  /** 更新项目 */
  async update(
    userId: string,
    projectIdParam: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectItem> {
    const project = await this.requireProject(projectIdParam, userId);
    await this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.startDate !== undefined
          ? { startDate: dto.startDate ? toDate(dto.startDate) : null }
          : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? toDate(dto.endDate) : null }
          : {}),
      },
    });
    return this.toProjectItem(project.id);
  }

  /** 删除项目：逻辑删除；下级任务与里程碑保留但不再可见 */
  async remove(userId: string, projectIdParam: string): Promise<void> {
    const project = await this.requireProject(projectIdParam, userId);
    await this.prisma.project.update({
      where: { id: project.id },
      data: { deleted: 1 },
    });
  }

  /** 项目成员列表 */
  async listMembers(projectIdParam: string): Promise<ProjectMemberItem[]> {
    const projectId = parseId(projectIdParam);
    if (projectId === null) {
      throw BizException.notFound('项目不存在');
    }
    return this.listMembersById(projectId);
  }

  /** 按主键取项目成员列表（内部用） */
  private async listMembersById(
    projectId: bigint,
  ): Promise<ProjectMemberItem[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId, deleted: 0 },
      include: {
        user: {
          select: { username: true, nickname: true, avatar: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      userId: toIdString(row.userId),
      username: row.user.username,
      nickname: row.user.nickname,
      avatar: row.user.avatar,
      email: row.user.email,
      joinedAt: formatDateTime(row.createdAt),
    }));
  }

  /** 添加项目成员：必须是课题组成员，且尚未加入本项目 */
  async addMember(
    userId: string,
    projectIdParam: string,
    targetUserIdParam: string,
  ): Promise<ProjectMemberItem> {
    const project = await this.requireProject(projectIdParam, userId);
    const targetUserId = parseId(targetUserIdParam);
    if (targetUserId === null) {
      throw BizException.param('userId 非法');
    }
    // 只能把本课题组的成员加进项目
    const membership = await this.prisma.teamMember.findFirst({
      where: { teamId: project.teamId, userId: targetUserId, deleted: 0 },
      select: { id: true },
    });
    if (!membership) {
      throw BizException.param('该用户不是本课题组成员');
    }

    const existing = await this.prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: targetUserId },
    });
    if (existing) {
      if (existing.deleted === 1) {
        // 唯一索引不过滤软删行，移除后重新加入要复用原行
        await this.prisma.projectMember.update({
          where: { id: existing.id },
          data: { deleted: 0 },
        });
      } else {
        throw BizException.conflict('该成员已在项目中');
      }
    } else {
      await this.prisma.projectMember.create({
        data: { projectId: project.id, userId: targetUserId },
      });
    }
    return this.findMemberItem(project.id, targetUserId);
  }

  /** 移除项目成员（逻辑删除） */
  async removeMember(
    userId: string,
    projectIdParam: string,
    targetUserIdParam: string,
  ): Promise<void> {
    const project = await this.requireProject(projectIdParam, userId);
    const targetUserId = parseId(targetUserIdParam);
    if (targetUserId === null) {
      throw BizException.param('userId 非法');
    }
    const existing = await this.prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: targetUserId, deleted: 0 },
    });
    if (!existing) {
      throw BizException.notFound('该成员不在项目中');
    }
    await this.prisma.projectMember.update({
      where: { id: existing.id },
      data: { deleted: 1 },
    });
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 取项目并校验访问权限：用户必须是该项目所属课题组的成员。
   * 这是红线 9 的落点——所有项目级接口都必须经过这里。
   */
  async requireProject(projectIdParam: string, userId: string) {
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

  /**
   * 确定项目归属的课题组：
   *   - 显式传 teamId 时校验用户是该组成员；
   *   - 未传时取用户加入的第一个课题组；
   *   - 都没有则报 400，提示先建组或入组。
   */
  private async resolveTeamId(
    userId: string,
    teamIdParam?: string,
  ): Promise<bigint> {
    if (teamIdParam) {
      const teamId = parseId(teamIdParam);
      if (teamId === null) {
        throw BizException.param('teamId 非法');
      }
      return teamId;
    }
    const teamIds = await listUserTeamIds(this.prisma, userId);
    const first = teamIds[0];
    if (first === undefined) {
      throw BizException.param('请先创建或加入课题组');
    }
    return first;
  }

  /** 聚合成项目条目：一次查询拿齐成员数、里程碑数、任务三列数 */
  private async toProjectItem(projectId: bigint): Promise<ProjectItem> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('项目不存在');
    }
    const [memberCount, milestoneAgg, taskAgg] = await Promise.all([
      this.prisma.projectMember.count({
        where: { projectId: project.id, deleted: 0 },
      }),
      this.prisma.milestone.groupBy({
        by: ['status'],
        where: { projectId: project.id, deleted: 0 },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: { projectId: project.id, deleted: 0 },
        _count: { _all: true },
      }),
    ]);

    const milestoneTotal = milestoneAgg.reduce(
      (sum, g) => sum + g._count._all,
      0,
    );
    const milestoneDone =
      milestoneAgg.find((g) => g.status === 'done')?._count._all ?? 0;
    const taskTotal = taskAgg.reduce((sum, g) => sum + g._count._all, 0);
    const countOf = (status: string) =>
      taskAgg.find((g) => g.status === status)?._count._all ?? 0;

    return {
      id: toIdString(project.id),
      teamId: toIdString(project.teamId),
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: formatDate(project.startDate),
      endDate: formatDate(project.endDate),
      memberCount,
      milestoneTotal,
      milestoneDone,
      taskTotal,
      taskTodo: countOf('todo'),
      taskDoing: countOf('doing'),
      taskDone: countOf('done'),
      createdAt: formatDateTime(project.createdAt),
    };
  }

  private async findMemberItem(
    projectId: bigint,
    userId: bigint,
  ): Promise<ProjectMemberItem> {
    const row = await this.prisma.projectMember.findFirst({
      where: { projectId, userId, deleted: 0 },
      include: {
        user: {
          select: { username: true, nickname: true, avatar: true, email: true },
        },
      },
    });
    if (!row) {
      throw BizException.notFound('项目成员不存在');
    }
    return {
      userId: toIdString(row.userId),
      username: row.user.username,
      nickname: row.user.nickname,
      avatar: row.user.avatar,
      email: row.user.email,
      joinedAt: formatDateTime(row.createdAt),
    };
  }
}

/** `yyyy-MM-dd` → Date（按 UTC 零点存，与库里 UTC 约定一致） */
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
