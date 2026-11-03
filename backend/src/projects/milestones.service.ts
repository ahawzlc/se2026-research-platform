import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.constants';
import { BizException } from '../common/result';
import { formatDate, formatDateTime, toIdString } from '../common/datetime';
import { parseId, requireTeamMembership } from '../common/team-access';
import { ProjectsService } from './projects.service';
import type { CreateMilestoneDto } from './dto/milestone.dto';
import type { UpdateMilestoneDto } from './dto/milestone.dto';
import type { ListMilestonesQueryDto } from './dto/project-query.dto';

/** 对外暴露的里程碑条目 */
export interface MilestoneItem {
  id: string;
  projectId: string;
  name: string;
  dueDate: string;
  status: string;
  createdAt: string;
}

/**
 * 里程碑服务（任务卡 B-1）。
 *
 * 埋点约定（docs/03）：里程碑完成写 `milestone_done`，权重 2.5。
 * 里程碑「完成」是状态型行为，用 recordOnce 做同对象去重——
 * 反复把同一个里程碑标成完成只计一次分。
 *
 * 里程碑从 done 退回 pending 时撤销该条埋点（反向行为扣减）。
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityService,
  ) {}

  /** 里程碑列表：按项目过滤，只返回本组可见的里程碑 */
  async list(
    userId: string,
    projectIdParam: string,
    query: ListMilestonesQueryDto,
  ): Promise<MilestoneItem[]> {
    const project = await this.projects.requireProject(projectIdParam, userId);
    const where = {
      projectId: project.id,
      deleted: 0,
      ...(query.status ? { status: query.status } : {}),
    };
    const rows = await this.prisma.milestone.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toItem(row));
  }

  /** 创建里程碑 */
  async create(
    userId: string,
    dto: CreateMilestoneDto,
  ): Promise<MilestoneItem> {
    const project = await this.projects.requireProject(dto.projectId, userId);
    const row = await this.prisma.milestone.create({
      data: {
        projectId: project.id,
        name: dto.name,
        dueDate: dto.dueDate ? toDate(dto.dueDate) : null,
        status: dto.status ?? 'pending',
      },
    });
    // 直接以 done 状态创建时也算一次达成
    if (row.status === 'done') {
      await this.recordMilestoneDone(userId, project.teamId, row.id);
    }
    return this.toItem(row);
  }

  /** 更新里程碑；状态变为 done 时写埋点，退回 pending 时撤销 */
  async update(
    userId: string,
    milestoneIdParam: string,
    dto: UpdateMilestoneDto,
  ): Promise<MilestoneItem> {
    const { milestone, project } = await this.requireMilestone(
      milestoneIdParam,
      userId,
    );
    const nextStatus = dto.status ?? milestone.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.milestone.update({
        where: { id: milestone.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.dueDate !== undefined
            ? { dueDate: dto.dueDate ? toDate(dto.dueDate) : null }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });

      // 埋点与业务写入同事务（docs/03 第二节要求）
      if (nextStatus === 'done' && milestone.status !== 'done') {
        await this.activity.recordOnce(tx, {
          userId,
          teamId: project.teamId,
          type: ActivityType.MILESTONE_DONE,
          refType: 'milestone',
          refId: row.id,
        });
      } else if (nextStatus !== 'done' && milestone.status === 'done') {
        await this.activity.revoke(tx, {
          userId,
          type: ActivityType.MILESTONE_DONE,
          refType: 'milestone',
          refId: row.id,
        });
      }
      return row;
    });

    return this.toItem(updated);
  }

  /** 删除里程碑（逻辑删除）；已完成的里程碑撤销其埋点 */
  async remove(userId: string, milestoneIdParam: string): Promise<void> {
    const { milestone, project } = await this.requireMilestone(
      milestoneIdParam,
      userId,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.milestone.update({
        where: { id: milestone.id },
        data: { deleted: 1 },
      });
      if (milestone.status === 'done') {
        await this.activity.revoke(tx, {
          userId,
          type: ActivityType.MILESTONE_DONE,
          refType: 'milestone',
          refId: milestone.id,
        });
      }
    });
    void project;
  }

  // ---------------------------------------------------------------- 内部

  /** 取里程碑并校验访问权限 */
  private async requireMilestone(
    milestoneIdParam: string,
    userId: string,
  ): Promise<{
    milestone: MilestoneRow;
    project: { id: bigint; teamId: bigint };
  }> {
    const milestoneId = parseId(milestoneIdParam);
    if (milestoneId === null) {
      throw BizException.notFound('里程碑不存在');
    }
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, deleted: 0 },
    });
    if (!milestone) {
      throw BizException.notFound('里程碑不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: milestone.projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('里程碑不存在');
    }
    await requireTeamMembership(this.prisma, project.teamId, userId);
    return { milestone, project };
  }

  /** 里程碑达成的埋点（同对象只记一次） */
  private async recordMilestoneDone(
    userId: string,
    teamId: bigint,
    milestoneId: bigint,
  ): Promise<void> {
    await this.activity.recordOnce(this.prisma, {
      userId,
      teamId,
      type: ActivityType.MILESTONE_DONE,
      refType: 'milestone',
      refId: milestoneId,
    });
  }

  private toItem(row: MilestoneRow): MilestoneItem {
    return {
      id: toIdString(row.id),
      projectId: toIdString(row.projectId),
      name: row.name,
      dueDate: formatDate(row.dueDate),
      status: row.status,
      createdAt: formatDateTime(row.createdAt),
    };
  }
}

/** 里程碑行类型（Prisma 生成的实体） */
type MilestoneRow = {
  id: bigint;
  projectId: bigint;
  name: string;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
};

/** `yyyy-MM-dd` → Date（UTC 零点） */
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
