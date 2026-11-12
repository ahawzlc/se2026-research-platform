import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BizException } from '../../common/result';
import {
  analyze,
  DIMENSIONS,
  evaluateActivities,
  LOG_LIMIT,
  weekOf,
} from './participation';
import { activitySources } from './activity-sources';
import type { DetailsQuery } from './stats.query';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string, teamId: string) {
    return this.withTeam(userId, teamId, async (tx, id) => {
      const { rows, members, doneTasks, comments } = await this.snapshot(
        tx,
        id,
      );
      const { details: _details, ...result } = analyze(
        rows,
        members,
        doneTasks,
        comments,
      );
      void _details;
      return { teamId, ...result };
    });
  }

  async details(userId: string, query: DetailsQuery) {
    const selectedUserId = query.userId ? this.id(query.userId) : undefined;
    const weekStart = query.weekStart;
    if (weekStart) {
      const date = new Date(`${weekStart}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || weekOf(weekStart) !== weekStart)
        throw BizException.param('weekStart 必须为有效的周一日期');
    }
    return this.withTeam(userId, query.teamId, async (tx, id) => {
      const types = DIMENSIONS.find(
        (dimension) => dimension.key === query.dimension,
      )?.types;
      const { rows, doneTasks, comments } = await this.snapshot(
        tx,
        id,
        selectedUserId,
        types,
      );
      // 周过滤放在去重与限额之后，避免切换周重新计入更早的重复行为。
      const details = evaluateActivities(rows, doneTasks, comments)
        .filter((event) => !weekStart || weekOf(event.createdAt) === weekStart)
        .reverse();
      const { page, size } = query;
      return {
        list: await activitySources(
          tx,
          id,
          details.slice((page - 1) * size, page * size),
        ),
        total: details.length,
        page,
        size,
      };
    });
  }

  private id(value: string) {
    if (
      !/^[1-9][0-9]{0,19}$/.test(value) ||
      BigInt(value) > 18446744073709551615n
    )
      throw BizException.param('id 超出有效范围');
    return BigInt(value);
  }

  private async withTeam<T>(
    userId: string,
    teamId: string,
    read: (tx: Prisma.TransactionClient, id: bigint) => Promise<T>,
  ) {
    const id = this.id(teamId);
    const caller = this.id(userId);
    // 同一响应内权限、成员与流水来自一致快照，避免边读边变造成明细对不上汇总。
    return this.prisma.$transaction(
      async (tx) => {
        const team = await tx.team.findFirst({
          where: { id, deleted: 0 },
          select: { id: true },
        });
        if (!team) throw BizException.notFound('课题组不存在');
        const membership = await tx.teamMember.findFirst({
          where: {
            teamId: id,
            userId: caller,
            deleted: 0,
            user: { deleted: 0 },
          },
          select: { id: true },
        });
        if (!membership)
          throw BizException.forbidden('仅本课题组成员可查看参与度');
        return read(tx, id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    id: bigint,
    selectedUserId?: bigint,
    types?: string[],
  ) {
    const members = await tx.teamMember.findMany({
      where: {
        teamId: id,
        deleted: 0,
        user: { deleted: 0 },
        ...(selectedUserId ? { userId: selectedUserId } : {}),
      },
      select: { userId: true, user: { select: { nickname: true } } },
      orderBy: { userId: 'asc' },
    });
    // activity_log 没有 deleted 字段；只读，不回写被过滤的原始记录。
    const rows = await tx.activityLog.findMany({
      where: {
        teamId: id,
        userId: { in: members.map((m) => m.userId) },
        ...(types ? { type: { in: types } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LOG_LIMIT + 1,
    });
    if (rows.length > LOG_LIMIT)
      throw BizException.param('团队流水超过首版统计上限，请联系维护者');
    const taskIds = rows
      .filter(
        (r) =>
          r.type === 'task_done' && r.refType === 'task' && r.refId !== null,
      )
      .map((r) => r.refId!);
    const tasks = taskIds.length
      ? await tx.task.findMany({
          where: {
            id: { in: [...new Set(taskIds)] },
            deleted: 0,
            status: 'done',
            project: { teamId: id, deleted: 0 },
          },
          select: { id: true },
        })
      : [];
    const messageIds = rows
      .filter(
        (r) =>
          r.type === 'comment_create' &&
          r.refType === 'message' &&
          r.refId !== null,
      )
      .map((r) => r.refId!);
    const comments = messageIds.length
      ? await tx.message.findMany({
          where: {
            id: { in: [...new Set(messageIds)] },
            deleted: 0,
            conversation: { deleted: 0, type: 'comment' },
          },
          select: { id: true, senderId: true },
        })
      : [];
    return {
      rows,
      members: members.map((m) => ({
        userId: String(m.userId),
        nickname: m.user.nickname,
      })),
      doneTasks: new Set(tasks.map((task) => String(task.id))),
      comments: new Set(
        comments.map((message) => `${message.id}/${message.senderId}`),
      ),
    };
  }
}
