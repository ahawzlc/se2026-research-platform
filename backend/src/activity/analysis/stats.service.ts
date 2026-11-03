import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BizException } from '../../common/result';
import { analyze, LOG_LIMIT } from './participation';
import type { DetailsQuery } from './stats.query';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string, teamId: string) {
    const { details: _details, ...result } = await this.snapshot(
      userId,
      teamId,
    );
    void _details;
    return { teamId, ...result };
  }

  async details(userId: string, query: DetailsQuery) {
    if (query.userId) this.id(query.userId);
    const snapshot = await this.snapshot(userId, query.teamId);
    const rows = snapshot.details
      .filter(
        (d) =>
          (!query.userId || d.userId === query.userId) &&
          (!query.dimension || d.dimension === query.dimension),
      )
      .reverse();
    const { page, size } = query;
    return {
      list: rows.slice((page - 1) * size, page * size),
      total: rows.length,
      page,
      size,
    };
  }

  private id(value: string) {
    if (
      !/^[1-9][0-9]{0,19}$/.test(value) ||
      BigInt(value) > 18446744073709551615n
    )
      throw BizException.param('id 超出有效范围');
    return BigInt(value);
  }

  private async snapshot(userId: string, teamId: string) {
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
        const members = await tx.teamMember.findMany({
          where: { teamId: id, deleted: 0, user: { deleted: 0 } },
          select: { userId: true, user: { select: { nickname: true } } },
          orderBy: { userId: 'asc' },
        });
        // activity_log 没有 deleted 字段；只读，不回写被过滤的原始记录。
        const rows = await tx.activityLog.findMany({
          where: { teamId: id, userId: { in: members.map((m) => m.userId) } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: LOG_LIMIT + 1,
        });
        if (rows.length > LOG_LIMIT)
          throw BizException.param('团队流水超过首版统计上限，请联系维护者');
        const taskIds = rows
          .filter(
            (r) =>
              r.type === 'task_done' &&
              r.refType === 'task' &&
              r.refId !== null,
          )
          .map((r) => r.refId!);
        const tasks = taskIds.length
          ? await tx.task.findMany({
              where: {
                id: { in: taskIds },
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
                id: { in: messageIds },
                deleted: 0,
                conversation: { deleted: 0, type: 'comment' },
              },
              select: { id: true, senderId: true },
            })
          : [];
        return analyze(
          rows,
          members.map((m) => ({
            userId: String(m.userId),
            nickname: m.user.nickname,
          })),
          new Set(tasks.map((t) => String(t.id))),
          new Set(comments.map((m) => `${m.id}/${m.senderId}`)),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
