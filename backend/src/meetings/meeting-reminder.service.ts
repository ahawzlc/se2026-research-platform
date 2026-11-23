import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatDateTime } from '../common/datetime';

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
    const from = new Date(now.getTime() + 55 * 60_000);
    const to = new Date(now.getTime() + 65 * 60_000);
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
      for (const attendee of meeting.attendees) {
        const notice = await this.notifications.pushOnce({
          toUserId: attendee.userId,
          type: 'meeting_upcoming',
          title: `会议《${meeting.title}》将于 ${time} 开始`,
          refType: 'meeting',
          refId: meeting.id,
        });
        if (notice) pushed += 1;
      }
    }
    if (pushed > 0) {
      this.logger.log(`已发送 ${pushed} 条会前提醒`);
    }
    return pushed;
  }
}
