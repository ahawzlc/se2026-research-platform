import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import {
  ACTIVITY_DAILY_LIMIT,
  ActivityType,
} from '../activity/activity.constants';
import { BizException } from '../common/result';
import { parseId } from '../common/team-access';
import { ConversationsService } from '../conversations/conversations.service';
import type { MessageItem } from '../conversations/conversations.service';
import { TasksService } from './tasks.service';

/**
 * 任务评论服务（任务卡 B-3）。
 *
 * 数据落点：**复用统一会话模型**（docs/02 第四节）——
 * 一条任务评论 = 一个 `conversation`（type=comment, ref_type=task, ref_id=taskId）
 * 下面的一条 `message`。因此不新建评论表，C 组的成果/会议评论也复用同一套结构。
 *
 * 埋点约定（docs/03）：写 `comment_create`，权重 0.5（讨论互动维度，最低），
 * 并受 `ACTIVITY_DAILY_LIMIT` 单日上限约束（评论类 10 条/日，防刷）。
 */
@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly conversations: ConversationsService,
    private readonly activity: ActivityService,
  ) {}

  /** 读取任务下的评论 */
  async list(
    userId: string,
    taskIdParam: string,
    limit?: number,
  ): Promise<MessageItem[]> {
    const task = await this.tasks.requireTask(taskIdParam, userId);
    const conversationId = await this.conversations.ensureAnchorConversation(
      'comment',
      'task',
      task.id,
      `任务「${task.title}」的讨论`,
    );
    return this.conversations.listMessages(conversationId, limit ?? 100);
  }

  /** 发表评论：写 message + comment_create 埋点 */
  async create(
    userId: string,
    taskIdParam: string,
    content: string,
  ): Promise<MessageItem> {
    const task = await this.tasks.requireTask(taskIdParam, userId);
    const project = await this.prisma.project.findFirst({
      where: { id: task.projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('任务不存在');
    }

    const conversationId = await this.conversations.ensureAnchorConversation(
      'comment',
      'task',
      task.id,
      `任务「${task.title}」的讨论`,
    );

    const message = await this.conversations.postMessage(
      conversationId,
      BigInt(userId),
      content,
    );

    // 埋点（反刷分第 2 条）：评论本身照常发布，但超出单日上限的部分**不再计入**参与度。
    // 这样既不影响正常讨论，又堵住了「狂刷评论刷分」的路子。
    const withinLimit = await this.isWithinDailyLimit(userId);
    if (withinLimit) {
      await this.activity.record({
        userId,
        teamId: project.teamId,
        type: ActivityType.COMMENT_CREATE,
        refType: 'task',
        refId: task.id,
      });
    }

    return message;
  }

  /**
   * 判断该用户当日的 comment_create 是否还在单日上限之内。
   *
   * 统计口径与 docs/03 第六节一致：同一成员同一 type 单日计入次数设上限。
   * 这里数的是**当日实际写入的埋点条数**，超出上限的评论不再写埋点。
   */
  private async isWithinDailyLimit(userId: string): Promise<boolean> {
    const limit = ACTIVITY_DAILY_LIMIT[ActivityType.COMMENT_CREATE];
    if (limit === undefined) {
      return true;
    }

    const startOfDay = startOfUtcDay(new Date());
    const count = await this.prisma.activityLog.count({
      where: {
        userId: BigInt(userId),
        type: ActivityType.COMMENT_CREATE,
        createdAt: { gte: startOfDay },
      },
    });
    return count < limit;
  }
}

/**
 * 取「今日零点」。
 *
 * 库里存的是 UTC（红线 4），埋点的 created_at 也是 UTC，
 * 因此单日上限按 UTC 日界切分，与库内时间口径一致。
 */
function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** 路径 id 校验（对外暴露给控制器用） */
export function parseCommentId(value: string): bigint | null {
  return parseId(value);
}
