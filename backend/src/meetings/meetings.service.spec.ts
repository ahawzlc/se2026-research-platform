import { MeetingsService } from './meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

/** 会议行快照（带 include 关系） */
interface MeetingRow {
  id: bigint;
  projectId: bigint;
  title: string;
  heldAt: Date | null;
  location: string | null;
  content: string | null;
  createdAt: Date;
  updatedAt: Date;
  deleted: number;
  project: { name: string };
  attendees: Array<{
    userId: bigint;
    user: {
      username: string;
      nickname: string;
      avatar: string;
      email: string;
    };
  }>;
}

/** 参会人行快照 */
interface AttendeeRow {
  id: bigint;
  meetingId: bigint;
  userId: bigint;
  deleted: number;
}

function buildMeeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 5n,
    projectId: 3n,
    title: '周会',
    heldAt: new Date('2026-11-10T06:30:00Z'), // 北京时间 14:30
    location: '线上',
    content: '讨论进度',
    createdAt: new Date('2026-11-05T02:00:00Z'),
    updatedAt: new Date('2026-11-05T02:00:00Z'),
    deleted: 0,
    project: { name: '智能感知实验平台' },
    attendees: [],
    ...overrides,
  };
}

/** 明确类型的 jest.fn 集合，避免 mockResolvedValue 传入 any */
function createService() {
  const tx = {
    meeting: {
      create: jest.fn<Promise<MeetingRow>, [unknown]>(),
      update: jest.fn<Promise<MeetingRow>, [unknown]>(),
    },
    meetingAttendee: {
      createMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
      create: jest.fn<Promise<AttendeeRow>, [unknown]>(),
      findMany: jest.fn<Promise<AttendeeRow[]>, [unknown]>(),
      update: jest.fn<Promise<AttendeeRow>, [unknown]>(),
    },
    activityLog: {
      count: jest.fn<Promise<number>, [unknown]>(),
    },
  };
  const prisma = {
    meeting: {
      create: jest.fn<Promise<MeetingRow>, [unknown]>(),
      findFirst: jest.fn<Promise<MeetingRow | null>, [unknown]>(),
      findMany: jest.fn<Promise<MeetingRow[]>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown]>(),
      update: jest.fn<Promise<MeetingRow>, [unknown]>(),
    },
    meetingAttendee: {
      createMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
      create: jest.fn<Promise<AttendeeRow>, [unknown]>(),
      findMany: jest.fn<Promise<AttendeeRow[]>, [unknown]>(),
      update: jest.fn<Promise<AttendeeRow>, [unknown]>(),
    },
    project: {
      findFirst: jest.fn<
        Promise<{ id: bigint; teamId: bigint } | null>,
        [unknown]
      >(),
    },
    teamMember: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<Array<{ userId: bigint }>, [unknown]>>(),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const activity = {
    recordInTransaction: jest.fn<Promise<void>, [unknown, unknown]>(),
    recordOnce: jest.fn<Promise<boolean>, [unknown, unknown]>(),
    revoke: jest.fn<Promise<boolean>, [unknown, unknown]>(),
    record: jest.fn<Promise<void>, [unknown]>(),
  };
  const service = new MeetingsService(
    prisma as unknown as PrismaService,
    activity as unknown as ActivityService,
  );
  return { service, prisma, tx, activity };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('MeetingsService.create', () => {
  it('项目不存在 → 404', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.create('1', { projectId: '99', title: '周会' }),
      404,
      '项目不存在',
    );
  });

  it('参会人不是本组成员 → 400', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([{ userId: 1n }]);
    await expectBizError(
      service.create('1', {
        projectId: '3',
        title: '周会',
        attendeeIds: ['1', '2'],
      }),
      400,
      '参会人必须是本课题组成员',
    );
  });

  it('创建成功：写 meeting + 参会人 + 创建者 meeting_create + 每人 meeting_attend', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([
      { userId: 1n },
      { userId: 2n },
    ]);
    tx.meeting.create.mockResolvedValue(buildMeeting());
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting());

    const result = await service.create('1', {
      projectId: '3',
      title: '周会',
      heldAt: '2026-11-10 14:30:00',
      location: '线上',
      content: '讨论进度',
      attendeeIds: ['1', '2'],
    });

    expect(result.id).toBe('5');
    expect(result.heldAt).toBe('2026-11-10 14:30:00');
    expect(tx.meeting.create).toHaveBeenCalledWith({
      data: {
        projectId: 3n,
        title: '周会',
        heldAt: new Date('2026-11-10T06:30:00Z'),
        location: '线上',
        content: '讨论进度',
      },
    });
    expect(tx.meetingAttendee.createMany).toHaveBeenCalledWith({
      data: [
        { meetingId: 5n, userId: 1n },
        { meetingId: 5n, userId: 2n },
      ],
    });
    expect(activity.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: '1',
        type: 'meeting_create',
        refType: 'meeting',
        refId: 5n,
      }),
    );
    expect(activity.recordOnce).toHaveBeenCalledTimes(2);
    expect(activity.recordOnce).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 1n, type: 'meeting_attend' }),
    );
    expect(activity.recordOnce).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 2n, type: 'meeting_attend' }),
    );
  });

  it('参会人最多 50 人', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    await expectBizError(
      service.create('1', {
        projectId: '3',
        title: '周会',
        attendeeIds: Array.from({ length: 51 }, (_, i) => String(i + 1)),
      }),
      400,
      '参会人最多 50 人',
    );
  });

  it('未填 heldAt 时存 null', async () => {
    const { service, prisma, tx } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    tx.meeting.create.mockResolvedValue(buildMeeting({ heldAt: null }));
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting({ heldAt: null }));

    await service.create('1', { projectId: '3', title: '待定会议' });

    const createCalls = tx.meeting.create.mock.calls as unknown as Array<
      [{ data: { heldAt: Date | null } }]
    >;
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][0].data.heldAt).toBeNull();
  });
});

describe('MeetingsService.update', () => {
  it('参会人全量替换：移除的软删 + 撤销埋点，新增的写行 + 写埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting());
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([
      { userId: 1n },
      { userId: 2n },
    ]);
    tx.meetingAttendee.findMany.mockResolvedValue([
      { id: 100n, meetingId: 5n, userId: 1n, deleted: 0 },
      { id: 101n, meetingId: 5n, userId: 3n, deleted: 0 },
    ]);
    tx.meeting.update.mockResolvedValue(buildMeeting());

    await service.update('1', '5', { attendeeIds: ['1', '2'] });

    expect(tx.meetingAttendee.update).toHaveBeenCalledWith({
      where: { id: 101n },
      data: { deleted: 1 },
    });
    expect(activity.revoke).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: '3', type: 'meeting_attend' }),
    );
    expect(tx.meetingAttendee.create).toHaveBeenCalledWith({
      data: { meetingId: 5n, userId: 2n },
    });
    expect(activity.recordOnce).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: '2', type: 'meeting_attend' }),
    );
  });

  it('恢复软删的参会人：update deleted=0 而不是 create', async () => {
    const { service, prisma, tx } = createService();
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting());
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.teamMember.findMany.mockResolvedValue([{ userId: 2n }]);
    tx.meetingAttendee.findMany.mockResolvedValue([
      { id: 102n, meetingId: 5n, userId: 2n, deleted: 1 },
    ]);
    tx.meeting.update.mockResolvedValue(buildMeeting());

    await service.update('1', '5', { attendeeIds: ['2'] });

    expect(tx.meetingAttendee.update).toHaveBeenCalledWith({
      where: { id: 102n },
      data: { deleted: 0 },
    });
    expect(tx.meetingAttendee.create).not.toHaveBeenCalled();
  });

  it('清空参会人：传空数组全部软删 + 撤销埋点', async () => {
    const { service, prisma, tx, activity } = createService();
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting());
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    tx.meetingAttendee.findMany.mockResolvedValue([
      { id: 100n, meetingId: 5n, userId: 1n, deleted: 0 },
      { id: 101n, meetingId: 5n, userId: 2n, deleted: 0 },
    ]);
    tx.meeting.update.mockResolvedValue(buildMeeting());

    await service.update('1', '5', { attendeeIds: [] });

    expect(tx.meetingAttendee.update).toHaveBeenCalledTimes(2);
    expect(activity.revoke).toHaveBeenCalledTimes(2);
  });
});

describe('MeetingsService.remove', () => {
  it('逻辑删除会议，不撤销埋点', async () => {
    const { service, prisma, activity } = createService();
    prisma.meeting.findFirst.mockResolvedValue(buildMeeting());
    prisma.project.findFirst.mockResolvedValue({ id: 3n, teamId: 7n });
    prisma.teamMember.findFirst.mockResolvedValue({
      teamId: 7n,
      userId: 1n,
      role: 'owner',
    });
    prisma.meeting.update.mockResolvedValue(buildMeeting({ deleted: 1 }));

    await service.remove('1', '5');

    expect(prisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { deleted: 1 },
    });
    expect(activity.revoke).not.toHaveBeenCalled();
  });
});

describe('MeetingsService.list', () => {
  it('无课题组返回空列表', async () => {
    const { service, prisma } = createService();
    prisma.teamMember.findMany.mockResolvedValue([]);
    const result = await service.list('1', { page: 1, size: 10 });
    expect(result).toEqual({ list: [], total: 0, page: 1, size: 10 });
  });
});
