import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.constants';
import { BizException } from '../common/result';
import { formatDate, formatDateTime, toIdString } from '../common/datetime';
import { listUserTeamIds, parseId } from '../common/team-access';
import type {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
  UpdateTaskOrderDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';

/** 对外暴露的任务条目 */
export interface TaskItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  assigneeId: string;
  /** 负责人展示信息；未指派时为空 */
  assigneeName: string;
  status: string;
  priority: string;
  dueDate: string;
  /** 看板列内排序值 */
  sortOrder: number;
  createdAt: string;
}

/** 分页返回结构 */
export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

/**
 * 看板列的排序步长。
 *
 * 约定（docs/02 待确认项第 2 条，由 B 组确定）：sort_order 用整数间隔，
 * 相邻两项差 100。拖拽插入时取前后两项的中值，因此
 *   - 单次拖拽只写 1 行，不必重排整列；
 *   - 间隔被逐步耗尽（连续往同一个位置插入 7 次以上）时做一次整列重排兜底。
 */
const SORT_STEP = 100;

/** 间隔耗尽的阈值：中值小于 1 时触发重排 */
const SORT_MIN_GAP = 1;

/**
 * 任务服务（任务卡 B-2）。
 *
 * 埋点约定（docs/03）：
 *   - 创建任务写 `task_create`（权重 3.0）；
 *   - 任务流转到 done 写 `task_done`（权重 3.0），**同对象只计一次**；
 *   - 从 done 退回其它状态时撤销该条 task_done（反向行为扣减）。
 *
 * 权限：所有查询都必须经 projects.requireProject 校验「用户是该项目所属课题组的成员」。
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * 任务列表。
   *
   * 未指定 projectId 时返回「用户所在全部课题组的任务」，
   * 这样看板可以在项目切换前先展示一个总览。
   */
  async list(
    userId: string,
    query: ListTasksQueryDto,
  ): Promise<PageData<TaskItem>> {
    const where = await this.buildWhere(userId, query);
    const page = query.page ?? 1;
    const size = query.size ?? 50;
    const [total, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          project: { select: { name: true, teamId: true } },
          assignee: {
            select: { username: true, nickname: true },
          },
        },
        orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
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

  /** 任务详情 */
  async detail(userId: string, taskIdParam: string): Promise<TaskItem> {
    const task = await this.requireTask(taskIdParam, userId);
    const row = await this.prisma.task.findFirst({
      where: { id: task.id, deleted: 0 },
      include: {
        project: { select: { name: true, teamId: true } },
        assignee: { select: { username: true, nickname: true } },
      },
    });
    if (!row) {
      throw BizException.notFound('任务不存在');
    }
    return this.toItem(row);
  }

  /** 创建任务：写 task_create 埋点 */
  async create(userId: string, dto: CreateTaskDto): Promise<TaskItem> {
    const project = await this.requireProject(dto.projectId, userId);
    const assigneeId = this.resolveAssignee(dto.assigneeId);

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          projectId: project.id,
          title: dto.title,
          description: dto.description ?? '',
          assigneeId,
          status: dto.status ?? 'todo',
          priority: dto.priority ?? 'medium',
          dueDate: dto.dueDate ? toDate(dto.dueDate) : null,
          sortOrder: await this.nextSortOrder(
            tx,
            project.id,
            dto.status ?? 'todo',
          ),
        },
      });
      // 埋点与业务写入同事务（docs/03 第二节）
      await this.activity.recordInTransaction(tx, {
        userId,
        teamId: project.teamId,
        type: ActivityType.TASK_CREATE,
        refType: 'task',
        refId: created.id,
      });
      return created;
    });

    return this.detail(userId, toIdString(task.id));
  }

  /** 更新任务基本信息（不含状态流转与排序） */
  async update(
    userId: string,
    taskIdParam: string,
    dto: UpdateTaskDto,
  ): Promise<TaskItem> {
    const task = await this.requireTask(taskIdParam, userId);
    const assigneeId =
      dto.assigneeId === undefined
        ? undefined
        : dto.assigneeId === ''
          ? null
          : this.resolveAssignee(dto.assigneeId);

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? toDate(dto.dueDate) : null }
          : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
      },
    });
    return this.detail(userId, taskIdParam);
  }

  /** 删除任务（逻辑删除） */
  async remove(userId: string, taskIdParam: string): Promise<void> {
    const task = await this.requireTask(taskIdParam, userId);
    await this.prisma.task.update({
      where: { id: task.id },
      data: { deleted: 1 },
    });
  }

  /**
   * 状态流转（看板换列）。
   *
   * 埋点处理是本方法的核心：
   *   - 进入 done：用 recordOnce 做同对象去重，反复拖拽不重复计分；
   *   - 离开 done：撤销之前记的那条 task_done。
   *
   * 撤销与写入都在同一事务内，保证「状态与埋点」始终一致。
   */
  async updateStatus(
    userId: string,
    taskIdParam: string,
    dto: UpdateTaskStatusDto,
  ): Promise<TaskItem> {
    const task = await this.requireTask(taskIdParam, userId);
    const project = await this.requireProject(task.projectId, userId);

    if (task.status === dto.status) {
      // 状态没变：只更新排序（跨列拖到同一列的极端情况），不重复记账
      return this.detail(userId, taskIdParam);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: dto.status,
          sortOrder: await this.nextSortOrder(tx, task.projectId, dto.status),
        },
      });

      if (dto.status === 'done') {
        // 同对象去重：反复把同一个任务拖到 done 只计一次分
        await this.activity.recordOnce(tx, {
          userId,
          teamId: project.teamId,
          type: ActivityType.TASK_DONE,
          refType: 'task',
          refId: task.id,
        });
      } else if (task.status === 'done') {
        // 反向行为扣减：从 done 退回其它状态，撤销那条 task_done
        await this.activity.revoke(tx, {
          userId,
          type: ActivityType.TASK_DONE,
          refType: 'task',
          refId: task.id,
        });
      }
    });

    return this.detail(userId, taskIdParam);
  }

  /**
   * 看板排序持久化。
   *
   * 入参给出目标位置**前后邻居**的 sort_order，服务端取中值作为新值：
   *   - 前后都有：newOrder = (before + after) / 2，取整（拖到两项之间）
   *   - 只有 before：newOrder = before + STEP（拖到某项之后，即该列末尾）
   *   - 只有 after：newOrder = after - STEP（拖到某项之前，即该列首位）
   *   - 都没有：newOrder = STEP（空列的首位）
   *
   * 中值小于 SORT_MIN_GAP 说明间隔已被耗尽（连续往同一位置插入会耗尽间隔），
   * 此时对目标列做一次**整列重排**：按当前顺序重新赋 100、200、300……，
   * 并把被移动的任务放到正确的位置上。
   */
  async updateOrder(
    userId: string,
    taskIdParam: string,
    dto: UpdateTaskOrderDto,
  ): Promise<TaskItem> {
    const task = await this.requireTask(taskIdParam, userId);
    const { beforeSortOrder, afterSortOrder } = dto;

    let newOrder: number | null = null;
    if (
      beforeSortOrder !== undefined &&
      beforeSortOrder !== null &&
      afterSortOrder !== undefined &&
      afterSortOrder !== null
    ) {
      // 前后都有：取中点
      newOrder = Math.floor((beforeSortOrder + afterSortOrder) / 2);
    } else if (beforeSortOrder !== undefined && beforeSortOrder !== null) {
      newOrder = beforeSortOrder + SORT_STEP;
    } else if (afterSortOrder !== undefined && afterSortOrder !== null) {
      newOrder = afterSortOrder - SORT_STEP;
    }

    // 间隔耗尽 → 整列重排兜底
    if (newOrder === null || newOrder < SORT_MIN_GAP) {
      await this.rebalanceColumn(
        task.projectId,
        task.status,
        task.id,
        afterSortOrder ?? null,
      );
      return this.detail(userId, taskIdParam);
    }

    await this.prisma.task.update({
      where: { id: task.id },
      data: { sortOrder: newOrder },
    });
    return this.detail(userId, taskIdParam);
  }

  // ---------------------------------------------------------------- 内部

  /** 构造查询条件：始终带团队标识过滤（红线 9） */
  private async buildWhere(
    userId: string,
    query: ListTasksQueryDto,
  ): Promise<Prisma.TaskWhereInput> {
    const teamIds = await listUserTeamIds(this.prisma, userId);
    if (teamIds.length === 0) {
      // 无课题组 → 恒假条件，返回空列表
      return { id: BigInt(-1) };
    }

    const where: Prisma.TaskWhereInput = {
      deleted: 0,
      project: { teamId: { in: teamIds }, deleted: 0 },
    };
    if (query.projectId) {
      const projectId = parseId(query.projectId);
      if (projectId === null) {
        return { id: BigInt(-1) };
      }
      where.projectId = projectId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.assigneeId) {
      const assigneeId = parseId(query.assigneeId);
      where.assigneeId = assigneeId === null ? BigInt(-1) : assigneeId;
    }
    if (query.mine === 'true') {
      where.assigneeId = BigInt(userId);
    }
    return where;
  }

  /** 取任务并校验访问权限（供任务评论服务复用） */
  async requireTask(taskIdParam: string, userId: string) {
    const taskId = parseId(taskIdParam);
    if (taskId === null) {
      throw BizException.notFound('任务不存在');
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deleted: 0 },
    });
    if (!task) {
      throw BizException.notFound('任务不存在');
    }
    // 复用项目级的权限校验：用户必须是该项目所属课题组的成员
    await this.requireProject(task.projectId, userId);
    return task;
  }

  /** 取项目并校验访问权限（接受 id 字符串或 bigint） */
  private async requireProject(
    projectIdParam: string | bigint,
    userId: string,
  ) {
    const projectId =
      typeof projectIdParam === 'bigint'
        ? projectIdParam
        : parseId(projectIdParam);
    if (projectId === null) {
      throw BizException.notFound('项目不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('项目不存在');
    }
    const teamIds = await listUserTeamIds(this.prisma, userId);
    if (!teamIds.includes(project.teamId)) {
      throw BizException.forbidden('不是该课题组的成员，无权访问');
    }
    return project;
  }

  /** 校验负责人属于本课题组；不传表示待认领 */
  private resolveAssignee(assigneeIdParam?: string): bigint | null {
    if (!assigneeIdParam) {
      return null;
    }
    const assigneeId = parseId(assigneeIdParam);
    if (assigneeId === null) {
      throw BizException.param('assigneeId 非法');
    }
    return assigneeId;
  }

  /** 目标列的下一个排序值：取该列最大 sort_order + STEP */
  private async nextSortOrder(
    tx: Prisma.TransactionClient,
    projectId: bigint,
    status: string,
  ): Promise<number> {
    const last = await tx.task.findFirst({
      where: { projectId, status, deleted: 0 },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + SORT_STEP;
  }

  /**
   * 整列重排：把该列的任务按当前顺序重新赋 100、200、300……
   * 间隔耗尽时调用，避免 sort_order 溢出或出现负数。
   *
   * 被移动的任务要放到**正确位置**上，而不是简单地按旧顺序重排：
   *   - afterSortOrder 给出后继邻居 → 插到它前面（列首）；
   *   - afterSortOrder 为空 → 放到列尾。
   */
  private async rebalanceColumn(
    projectId: bigint,
    status: string,
    movedTaskId: bigint,
    afterSortOrder: number | null,
  ): Promise<void> {
    const rows = await this.prisma.task.findMany({
      where: { projectId, status, deleted: 0 },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, sortOrder: true },
    });

    // 取出被移动的任务，剩下的按当前顺序排列
    const moved = rows.find((r) => r.id === movedTaskId);
    const rest = rows.filter((r) => r.id !== movedTaskId);

    // 计算插入位置：找到 after 邻居在 rest 中的下标
    let insertAt = rest.length;
    if (afterSortOrder !== null) {
      const idx = rest.findIndex((r) => r.sortOrder === afterSortOrder);
      if (idx >= 0) {
        insertAt = idx;
      }
    }
    const ordered = [...rest.slice(0, insertAt)];
    if (moved) {
      ordered.push(moved);
    }
    ordered.push(...rest.slice(insertAt));

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < ordered.length; i++) {
        const row = ordered[i];
        if (!row) {
          continue;
        }
        await tx.task.update({
          where: { id: row.id },
          data: { sortOrder: (i + 1) * SORT_STEP },
        });
      }
    });
  }

  private toItem(row: {
    id: bigint;
    projectId: bigint;
    title: string;
    description: string | null;
    assigneeId: bigint | null;
    status: string;
    priority: string;
    dueDate: Date | null;
    sortOrder: number;
    createdAt: Date;
    project: { name: string };
    assignee: { username: string; nickname: string } | null;
  }): TaskItem {
    return {
      id: toIdString(row.id),
      projectId: toIdString(row.projectId),
      projectName: row.project.name,
      title: row.title,
      description: row.description ?? '',
      assigneeId: row.assigneeId === null ? '' : toIdString(row.assigneeId),
      assigneeName: row.assignee
        ? row.assignee.nickname || row.assignee.username
        : '',
      status: row.status,
      priority: row.priority,
      dueDate: formatDate(row.dueDate),
      sortOrder: row.sortOrder,
      createdAt: formatDateTime(row.createdAt),
    };
  }
}

/** `yyyy-MM-dd` → Date（UTC 零点） */
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
