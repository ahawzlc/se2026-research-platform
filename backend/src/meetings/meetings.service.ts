import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.constants';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import {
  listUserTeamIds,
  parseId,
  requireId,
  requireTeamMembership,
} from '../common/team-access';
import type { CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import type { ListMeetingsQueryDto } from './dto/meeting-query.dto';

/** 参会人条目 */
export interface AttendeeItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
}

/** 对外暴露的会议条目（列表与详情共用） */
export interface MeetingItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  /** 北京时间 yyyy-MM-dd HH:mm:ss；未填时为空串 */
  heldAt: string;
  location: string;
  content: string;
  attendees: AttendeeItem[];
  createdAt: string;
  updatedAt: string;
}

/** 分页返回结构（docs/01 第四节） */
export interface PageData<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

/** 参会人上限：组规模小，50 足够，防止一次请求塞爆 */
const MAX_ATTENDEES = 50;

/**
 * 会议服务（任务卡 C-2）。
 *
 * 约定：
 *   - 会议挂在项目下，权限校验走「项目所属团队的成员」（红线 9）；
 *   - 创建会议写 `meeting_create`（创建者，权重 1.5）；
 *   - 参会人各写一条 `meeting_attend`（权重 1.5），`recordOnce` 保证同一人同一会议只计一次；
 *   - 创建者若也在参会人列表里，两条埋点都写（创建 + 参会，语义不同）；
 *   - 删除会议**不撤销埋点**：会议表无 creator_id 无法定位创建者，且会议创建是真实发生过的，
 *     逻辑删除后保留历史埋点更合理。
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** 创建会议：同事务写 meeting + 参会人 + 埋点 */
  async create(userId: string, dto: CreateMeetingDto): Promise<MeetingItem> {
    const project = await this.requireProject(dto.projectId, userId);
    const heldAt = dto.heldAt ? toDate(dto.heldAt) : null;
    const attendeeIds = await this.validateAttendees(
      dto.attendeeIds,
      project.teamId,
    );

    const meeting = await this.prisma.$transaction(async (tx) => {
      const created = await tx.meeting.create({
        data: {
          projectId: project.id,
          title: dto.title,
          heldAt,
          location: dto.location || null,
          content: dto.content || null,
        },
      });

      if (attendeeIds.length > 0) {
        await tx.meetingAttendee.createMany({
          data: attendeeIds.map((uid) => ({
            meetingId: created.id,
            userId: uid,
          })),
        });
      }

      // meeting_create：创建者一条
      await this.activity.recordInTransaction(tx, {
        userId,
        teamId: project.teamId,
        type: ActivityType.MEETING_CREATE,
        refType: 'meeting',
        refId: created.id,
      });

      // meeting_attend：每个参会人一条，同对象去重
      for (const attendeeId of attendeeIds) {
        await this.activity.recordOnce(tx, {
          userId: attendeeId,
          teamId: project.teamId,
          type: ActivityType.MEETING_ATTEND,
          refType: 'meeting',
          refId: created.id,
        });
      }

      return created;
    });

    return this.detail(userId, toIdString(meeting.id));
  }

  /** 会议列表：分页，按项目过滤，仅返回本课题组可见的会议 */
  async list(
    userId: string,
    query: ListMeetingsQueryDto,
  ): Promise<PageData<MeetingItem>> {
    const teamIds = await listUserTeamIds(this.prisma, userId);
    const page = query.page ?? 1;
    const size = query.size ?? 10;
    if (teamIds.length === 0) {
      return { list: [], total: 0, page, size };
    }

    const where: Prisma.MeetingWhereInput = {
      deleted: 0,
      project: { teamId: { in: teamIds }, deleted: 0 },
    };
    if (query.projectId) {
      const projectId = parseId(query.projectId);
      where.projectId = projectId === null ? BigInt(-1) : projectId;
    }

    const [total, rows] = await Promise.all([
      this.prisma.meeting.count({ where }),
      this.prisma.meeting.findMany({
        where,
        include: {
          project: { select: { name: true } },
          attendees: {
            where: { deleted: 0 },
            include: {
              user: {
                select: {
                  username: true,
                  nickname: true,
                  avatar: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        // MySQL 里 DESC 排序时 NULL 排最后，未填时间的会议排在最后
        orderBy: [{ heldAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    return {
      list: rows.map((row) => this.toItem(row)),
      total,
      page,
      size,
    };
  }

  /** 会议详情 */
  /** 会议详情 */
  async detail(userId: string, idParam: string): Promise<MeetingItem> {
    const { meeting } = await this.requireMeeting(idParam, userId);
    const row = await this.prisma.meeting.findFirst({
      where: { id: meeting.id, deleted: 0 },
      include: {
        project: { select: { name: true } },
        attendees: {
          where: { deleted: 0 },
          include: {
            user: {
              select: {
                username: true,
                nickname: true,
                avatar: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) {
      throw BizException.notFound('会议不存在');
    }
    return this.toItem(row);
  }

  /** 更新会议：基本信息 + 参会人全量替换 */
  async update(
    userId: string,
    idParam: string,
    dto: UpdateMeetingDto,
  ): Promise<MeetingItem> {
    const { meeting, project } = await this.requireMeeting(idParam, userId);

    const heldAt =
      dto.heldAt !== undefined
        ? dto.heldAt
          ? toDate(dto.heldAt)
          : null
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: meeting.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(heldAt !== undefined ? { heldAt } : {}),
          ...(dto.location !== undefined
            ? { location: dto.location || null }
            : {}),
          ...(dto.content !== undefined
            ? { content: dto.content || null }
            : {}),
        },
      });

      if (dto.attendeeIds !== undefined) {
        await this.syncAttendees(
          tx,
          meeting.id,
          project.teamId,
          dto.attendeeIds,
        );
      }
    });

    return this.detail(userId, idParam);
  }

  /** 逻辑删除会议；不撤销历史埋点（见类注释） */
  async remove(userId: string, idParam: string): Promise<void> {
    const { meeting } = await this.requireMeeting(idParam, userId);
    await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { deleted: 1 },
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 取会议并校验访问权限（红线 9） */
  private async requireMeeting(idParam: string, userId: string) {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('会议不存在');
    }
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, deleted: 0 },
    });
    if (!meeting) {
      throw BizException.notFound('会议不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: meeting.projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('会议不存在');
    }
    await requireTeamMembership(this.prisma, project.teamId, userId);
    return { meeting, project };
  }

  /** 取项目并校验访问权限（会议创建时的入口） */
  private async requireProject(projectIdParam: string, userId: string) {
    const projectId = parseId(projectIdParam);
    if (projectId === null) {
      throw BizException.notFound('项目不存在');
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deleted: 0 },
    });
    if (!project) {
      throw BizException.notFound('项目不存在');
    }
    await requireTeamMembership(this.prisma, project.teamId, userId);
    return project;
  }

  /**
   * 校验参会人：必须是本课题组成员，去重，最多 MAX_ATTENDEES 人。
   * 返回去重后的 bigint 数组，保持原顺序。
   */
  private async validateAttendees(
    attendeeIds: string[] | undefined,
    teamId: bigint,
  ): Promise<bigint[]> {
    if (!attendeeIds || attendeeIds.length === 0) {
      return [];
    }
    // 去重 + 校验格式
    const seen = new Set<string>();
    const ids: bigint[] = [];
    for (const raw of attendeeIds) {
      const id = requireId(raw, 'attendeeIds 含非法 id');
      const key = id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(id);
    }
    if (ids.length > MAX_ATTENDEES) {
      throw BizException.param(`参会人最多 ${MAX_ATTENDEES} 人`);
    }
    // 校验都是本组成员
    const members = await this.prisma.teamMember.findMany({
      where: { teamId, userId: { in: ids }, deleted: 0 },
      select: { userId: true },
    });
    const validSet = new Set(members.map((m) => m.userId.toString()));
    for (const id of ids) {
      if (!validSet.has(id.toString())) {
        throw BizException.param('参会人必须是本课题组成员');
      }
    }
    return ids;
  }

  /**
   * 同步参会人：软删移除的、恢复软删的、新增的，并同步 meeting_attend 埋点。
   *
   * 唯一索引 uk_meeting_attendee(meeting_id, user_id) 不过滤软删行，
   * 所以「恢复」必须 update 原行而不是 create。
   *
   * meeting_attend 的撤销用 revoke（权重置 0），恢复时 recordOnce 会重新写一条
   * （因为 recordOnce 只认 weight > 0 的埋点），保证「撤销 → 再加入」能重新计分。
   */
  private async syncAttendees(
    tx: Prisma.TransactionClient,
    meetingId: bigint,
    teamId: bigint,
    attendeeIds: string[],
  ): Promise<void> {
    const nextIds = await this.validateAttendees(attendeeIds, teamId);
    const nextSet = new Set(nextIds.map((id) => id.toString()));

    const existing = await tx.meetingAttendee.findMany({
      where: { meetingId },
      select: { id: true, userId: true, deleted: true },
    });
    const existingMap = new Map(
      existing.map((row) => [row.userId.toString(), row]),
    );

    // 移除的：软删 + 撤销埋点
    for (const row of existing) {
      const userIdStr = row.userId.toString();
      if (row.deleted === 0 && !nextSet.has(userIdStr)) {
        await tx.meetingAttendee.update({
          where: { id: row.id },
          data: { deleted: 1 },
        });
        await this.activity.revoke(tx, {
          userId: userIdStr,
          type: ActivityType.MEETING_ATTEND,
          refType: 'meeting',
          refId: meetingId,
        });
      }
    }

    // 新增或恢复的：写 attendance + 写埋点
    for (const userId of nextIds) {
      const userIdStr = userId.toString();
      const row = existingMap.get(userIdStr);
      if (row) {
        if (row.deleted === 1) {
          await tx.meetingAttendee.update({
            where: { id: row.id },
            data: { deleted: 0 },
          });
          await this.activity.recordOnce(tx, {
            userId: userIdStr,
            teamId,
            type: ActivityType.MEETING_ATTEND,
            refType: 'meeting',
            refId: meetingId,
          });
        }
        // 已存在且未删的：不动
      } else {
        await tx.meetingAttendee.create({
          data: { meetingId, userId },
        });
        await this.activity.recordOnce(tx, {
          userId: userIdStr,
          teamId,
          type: ActivityType.MEETING_ATTEND,
          refType: 'meeting',
          refId: meetingId,
        });
      }
    }
  }

  private toItem(row: {
    id: bigint;
    projectId: bigint;
    title: string;
    heldAt: Date | null;
    location: string | null;
    content: string | null;
    createdAt: Date;
    updatedAt: Date;
    project: { name: string };
    attendees: {
      userId: bigint;
      user: {
        username: string;
        nickname: string;
        avatar: string;
        email: string;
      };
    }[];
  }): MeetingItem {
    return {
      id: toIdString(row.id),
      projectId: toIdString(row.projectId),
      projectName: row.project.name,
      title: row.title,
      heldAt: formatDateTime(row.heldAt),
      location: row.location ?? '',
      content: row.content ?? '',
      attendees: row.attendees.map((a) => ({
        userId: toIdString(a.userId),
        username: a.user.username,
        nickname: a.user.nickname,
        avatar: a.user.avatar,
        email: a.user.email,
      })),
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}

/**
 * `yyyy-MM-dd HH:mm:ss`（北京时间）→ Date（UTC）。
 *
 * 手动拼接 `+08:00` 让 JS 明确按北京时间解析，避免 `new Date('2026-11-10 14:30:00')`
 * 在不同 Node 环境下被解释成本地时区的歧义。
 */
function toDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + '+08:00');
}
