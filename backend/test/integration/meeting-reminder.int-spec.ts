/** F-2 真库验收：不替换 Provider，真实执行 cron → pushOnce → MySQL → HTTP。 */
import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MeetingReminderService } from '../../src/meetings/meeting-reminder.service';
import { formatDateTime } from '../../src/common/datetime';
import {
  createIntegrationApp,
  envelope,
  maybe,
  registerUser,
  RUN,
} from './setup';

maybe('F-2 会议提醒真库集成', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let reminder: MeetingReminderService;
  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;
  let teamId: bigint | undefined;
  let projectId: bigint;
  const userIds: bigint[] = [];
  const projectIds: bigint[] = [];
  const meetingIds: bigint[] = [];

  beforeAll(async () => {
    app = await createIntegrationApp();
    prisma = app.get(PrismaService);
    reminder = app.get(MeetingReminderService);
    // 避免后台分钟任务与显式触发的一轮 cron 竞争；Provider 与数据库均为真实实现。
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    alice = await registerUser(app, `f2_a_${RUN}`);
    userIds.push(BigInt(alice.userId));
    bob = await registerUser(app, `f2_b_${RUN}`);
    userIds.push(BigInt(bob.userId));
    outsider = await registerUser(app, `f2_o_${RUN}`);
    userIds.push(BigInt(outsider.userId));

    const team = await prisma.team.create({
      data: {
        name: `F-2 测试组 ${RUN}`,
        ownerId: BigInt(alice.userId),
        inviteCode: `f2${RUN}`,
      },
    });
    teamId = team.id;
    await prisma.teamMember.createMany({
      data: [
        { teamId, userId: BigInt(alice.userId), role: 'owner' },
        { teamId, userId: BigInt(bob.userId), role: 'member' },
      ],
    });
    const project = await prisma.project.create({
      data: { teamId, name: 'F-2 提醒项目' },
    });
    projectId = project.id;
    projectIds.push(projectId);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        // 只清理本套件创建的精确 id，按外键依赖顺序执行。
        await prisma.notification.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.meetingAttendee.deleteMany({
          where: { meetingId: { in: meetingIds } },
        });
        await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
        await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
        if (teamId !== undefined) {
          await prisma.teamMember.deleteMany({ where: { teamId } });
          await prisma.team.delete({ where: { id: teamId } });
        }
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  async function createMeeting(
    heldAt: Date | null,
    options: {
      deleted?: number;
      projectId?: bigint;
      removedBob?: boolean;
    } = {},
  ) {
    const meeting = await prisma.meeting.create({
      data: {
        projectId: options.projectId ?? projectId,
        title: `F-2 提醒验收 ${meetingIds.length}`,
        heldAt,
        deleted: options.deleted ?? 0,
      },
    });
    meetingIds.push(meeting.id);
    await prisma.meetingAttendee.createMany({
      data: [
        { meetingId: meeting.id, userId: BigInt(alice.userId) },
        {
          meetingId: meeting.id,
          userId: BigInt(bob.userId),
          deleted: options.removedBob ? 1 : 0,
        },
      ],
    });
    return meeting;
  }

  it('造一条 55 分钟后的会议，跑一轮 cron，所有参会人的通知真实落库；重复执行不再写入', async () => {
    // 秒精度与 MySQL DATETIME(0) 一致。handleCron 使用真实当前时间，显式扫描用固定 now 验证闭区间下界。
    const now = new Date(Math.ceil(Date.now() / 1000) * 1000);
    const meeting = await createMeeting(new Date(now.getTime() + 55 * 60_000));
    const where = {
      type: 'meeting_upcoming',
      refType: 'meeting',
      refId: meeting.id,
      deleted: 0,
    };

    await reminder.runOnce(now);

    const rows = await prisma.notification.findMany({
      where,
      orderBy: { userId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId.toString()).sort()).toEqual(
      [alice.userId, bob.userId].sort(),
    );
    expect(rows.every((row) => row.isRead === 0)).toBe(true);
    expect(rows[0].title).toBe(
      `会议《${meeting.title}》将于 ${formatDateTime(meeting.heldAt).slice(11, 16)} 开始`,
    );

    await prisma.notification.updateMany({ where, data: { isRead: 1 } });
    await reminder.runOnce(now);
    await reminder.handleCron();
    expect(await prisma.notification.count({ where })).toBe(2);

    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const body = envelope<{ list: Array<{ refType: string; refId: string }> }>(
      response,
    );
    expect(body.code).toBe(0);
    expect(body.data?.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refType: 'meeting',
          refId: meeting.id.toString(),
        }),
      ]),
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/meetings/${meeting.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    expect(envelope<{ id: string; status: string }>(detail).data).toMatchObject(
      {
        id: meeting.id.toString(),
        status: 'upcoming',
      },
    );
  });

  it('跨组用户不能通过提醒来源 id 读取会议，也收不到该会议通知', async () => {
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const meeting = await createMeeting(new Date(now.getTime() + 60 * 60_000));
    await reminder.runOnce(now);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/meetings/${meeting.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
    expect(envelope<null>(response).code).toBe(403);
    expect(
      await prisma.notification.count({
        where: {
          userId: BigInt(outsider.userId),
          refType: 'meeting',
          refId: meeting.id,
          deleted: 0,
        },
      }),
    ).toBe(0);
  });

  it('窗口上下界闭合；窗口外、无时间、已删会议、已删项目与已删参会人不推送', async () => {
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
    const deletedProject = await prisma.project.create({
      data: { teamId: teamId!, name: 'F-2 已删项目', deleted: 1 },
    });
    projectIds.push(deletedProject.id);
    const lower = await createMeeting(at(55 * 60));
    const upper = await createMeeting(at(65 * 60), { removedBob: true });
    const excluded = [
      await createMeeting(at(55 * 60 - 1)),
      await createMeeting(at(65 * 60 + 1)),
      await createMeeting(null),
      await createMeeting(at(60 * 60), { deleted: 1 }),
      await createMeeting(at(60 * 60), { projectId: deletedProject.id }),
    ];

    await reminder.runOnce(now);

    expect(
      await prisma.notification.count({
        where: { refType: 'meeting', refId: lower.id, deleted: 0 },
      }),
    ).toBe(2);
    expect(
      await prisma.notification.count({
        where: { refType: 'meeting', refId: upper.id, deleted: 0 },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: {
          refType: 'meeting',
          refId: { in: excluded.map((row) => row.id) },
          deleted: 0,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: {
          userId: BigInt(bob.userId),
          refType: 'meeting',
          refId: upper.id,
          deleted: 0,
        },
      }),
    ).toBe(0);
  });
});
