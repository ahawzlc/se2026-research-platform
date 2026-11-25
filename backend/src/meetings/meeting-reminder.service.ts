import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatDateTime } from '../common/datetime';
import { NOTIFICATION_TITLE_MAX } from '../notifications/notification.constants';

/** 每分钟扫描一次，给会议开始前约一小时的所有参会人发送铃铛通知。 */
@Injectable()
export class MeetingReminderService {
  private readonly logger = new Logger(MeetingReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  /** 暴露给集成测试和手工验收脚本，避免等待真实 cron。 */
  async runOnce(now = new Date()): Promise<number> {
    // 覆盖临时创建、改期、重启和后来加入的参会人；已有通知由 pushOnce 去重。
    const from = now;
    const to = new Date(now.getTime() + 60 * 60_000);
    const meetings = await this.prisma.meeting.findMany({
      where: {
        deleted: 0,
        heldAt: { gte: from, lte: to },
        project: { deleted: 0 },
      },
      select: {
        id: true,
        title: true,
        heldAt: true,
        attendees: {
          where: { deleted: 0 },
          select: { userId: true },
        },
      },
    });

    let pushed = 0;
    for (const meeting of meetings) {
      if (!meeting.heldAt) continue;
      const time = formatDateTime(meeting.heldAt).slice(11, 16);
      const prefix = '会议《';
      const suffix = `》将于 ${time} 开始`;
      const maxTopicLength = Math.min(
        60,
        NOTIFICATION_TITLE_MAX - prefix.length - suffix.length,
      );
      const topic =
        meeting.title.length > maxTopicLength
          ? `${meeting.title.slice(0, maxTopicLength - 1)}…`
          : meeting.title;
      const title = `${prefix}${topic}${suffix}`;
      for (const attendee of meeting.attendees) {
        try {
          const notice = await this.notifications.pushOnce({
            toUserId: attendee.userId,
            type: 'meeting_upcoming',
            title,
            refType: 'meeting',
            refId: meeting.id,
          });
          if (notice) pushed += 1;
        } catch (error) {
          // 单人发送失败不影响后续会议/参会人；仍在窗口内时下一轮可重试。
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `会议 ${meeting.id} 向用户 ${attendee.userId} 发送提醒失败：${reason}`,
          );
        }
      }
    }
    if (pushed > 0) {
      this.logger.log(`已发送 ${pushed} 条会前提醒`);
    }
    return pushed;
  }
}
