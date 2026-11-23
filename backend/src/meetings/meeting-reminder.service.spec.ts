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
});
