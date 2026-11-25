import { MeetingReminderService } from './meeting-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { PushNotificationInput } from '../notifications/notifications.service';
import { Logger } from '@nestjs/common';

describe('MeetingReminderService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('扫描现在至 60 分钟后的闭区间，并尊重幂等结果', async () => {
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
          gte: now,
          lte: new Date(now.getTime() + 60 * 60_000),
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

  it('三场会议中间是 190 字主题，三位参会人均推送，标题不超 200 字', async () => {
    const now = new Date('2026-11-25T00:00:00Z');
    const prisma = { meeting: { findMany: jest.fn() } };
    prisma.meeting.findMany.mockResolvedValue([
      { id: 1n, title: '第一场', heldAt: now, attendees: [{ userId: 1n }] },
      {
        id: 2n,
        title: '长'.repeat(190),
        heldAt: now,
        attendees: [{ userId: 2n }],
      },
      { id: 3n, title: '第三场', heldAt: now, attendees: [{ userId: 3n }] },
    ]);
    const notifications = {
      pushOnce: jest.fn().mockImplementation((input: PushNotificationInput) => {
        expect(input.title.length).toBeLessThanOrEqual(200);
        if (input.refId === 2n) {
          expect(input.title).toBe(
            `会议《${'长'.repeat(59)}…》将于 08:00 开始`,
          );
        }
        return Promise.resolve({ id: '1' });
      }),
    };
    const service = new MeetingReminderService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    await expect(service.runOnce(now)).resolves.toBe(3);
    expect(notifications.pushOnce).toHaveBeenCalledTimes(3);
    expect(notifications.pushOnce).toHaveBeenLastCalledWith(
      expect.objectContaining({ refId: 3n, toUserId: 3n }),
    );
  });

  it('单个参会人失败时记录日志并继续，下一轮仍能重试失败的人', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const now = new Date('2026-11-25T00:00:00Z');
    const prisma = { meeting: { findMany: jest.fn() } };
    prisma.meeting.findMany.mockResolvedValue([
      {
        id: 1n,
        title: '第一场',
        heldAt: now,
        attendees: [{ userId: 1n }, { userId: 2n }],
      },
      { id: 2n, title: '第二场', heldAt: now, attendees: [{ userId: 3n }] },
    ]);
    const notifications = {
      pushOnce: jest
        .fn()
        .mockResolvedValueOnce({ id: '1' })
        .mockRejectedValueOnce(new Error('临时写库失败'))
        .mockResolvedValueOnce({ id: '3' }),
    };
    const service = new MeetingReminderService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    await expect(service.runOnce(now)).resolves.toBe(2);
    expect(notifications.pushOnce).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('临时写库失败'));
    notifications.pushOnce
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: '2' })
      .mockResolvedValueOnce(null);
    await expect(service.runOnce(now)).resolves.toBe(1);
  });
});
