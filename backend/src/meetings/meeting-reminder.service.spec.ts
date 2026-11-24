import { MeetingReminderService } from './meeting-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('MeetingReminderService', () => {
  it('只给 55–65 分钟窗口内的参会人推送，并尊重幂等结果', async () => {
    const prisma = {
      meeting: { findMany: jest.fn() },
    };
    const notifications = { pushOnce: jest.fn() };
    const service = new MeetingReminderService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
    const now = new Date('2026-11-23T00:00:00.000Z');
    prisma.meeting.findMany.mockResolvedValue([
      {
        id: 10n,
        title: '需求评审',
        heldAt: new Date(now.getTime() + 55 * 60_000),
        attendees: [{ userId: 1n }, { userId: 2n }],
      },
    ]);
    notifications.pushOnce.mockResolvedValue({ id: '1' });

    await expect(service.runOnce(now)).resolves.toBe(2);
    expect(prisma.meeting.findMany).toHaveBeenCalledWith({
      where: {
        deleted: 0,
        heldAt: {
          gte: new Date(now.getTime() + 55 * 60_000),
          lte: new Date(now.getTime() + 65 * 60_000),
        },
        project: { deleted: 0 },
      },
      select: {
        id: true,
        title: true,
        heldAt: true,
        attendees: { where: { deleted: 0 }, select: { userId: true } },
      },
    });
    expect(notifications.pushOnce).toHaveBeenCalledTimes(2);
    expect(notifications.pushOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        toUserId: 1n,
        type: 'meeting_upcoming',
        refType: 'meeting',
        refId: 10n,
      }),
    );

    notifications.pushOnce.mockResolvedValue(null);
    await expect(service.runOnce(now)).resolves.toBe(0);
  });

  it('定时入口执行一轮扫描', async () => {
    const service = new MeetingReminderService(
      {} as PrismaService,
      {} as NotificationsService,
    );
    const run = jest.spyOn(service, 'runOnce').mockResolvedValue(0);

    await service.handleCron();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
