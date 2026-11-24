import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from '../teams/teams.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { isUniqueViolation } from '../common/prisma-errors';
import { parseId } from '../common/team-access';
import type { ApplicationStatus } from './community.constants';
import type { PageData, PostAuthor } from './posts.service';
import { requirePostAuthor, requireVisiblePost } from './post-access';
import type { ApplyPostDto } from './dto/apply-post.dto';
import type { ListApplicationsQueryDto } from './dto/list-applications.query';

/** 申请条目（列表与审批响应共用） */
export interface ApplicationItem {
  id: string;
  postId: string;
  /** pending 待处理 / approved 已通过 / rejected 已拒绝 */
  status: ApplicationStatus;
  note: string;
  createdAt: string;
  /** 未处理时为空字符串 */
  handledAt: string;
  applicant: PostAuthor;
}

/** 审批（通过 / 拒绝）的响应 */
export interface HandleResult {
  application: ApplicationItem;
  /** 处理后的帖子进度与状态，前端据此就地刷新 */
  post: {
    recruitedCount: number;
    recruitTotal: number;
    status: string;
    team: { id: string; name: string } | null;
  };
  /** 仅「本次审批自动创建了课题组」时返回：邀请码只在创建时给出一次 */
  inviteCode?: string;
}

/** 审批结果：通过 / 拒绝 */
type Decision = Extract<ApplicationStatus, 'approved' | 'rejected'>;

/** 审批通过后自动创建的课题组简介 */
const AUTO_TEAM_DESCRIPTION = '由组队广场招募帖自动创建';

/** 已有申请（任何状态）时再次申请的提示 */
const EXISTING_APPLICATION_MESSAGES: Record<ApplicationStatus, string> = {
  pending: '已申请，请等待发帖人处理',
  approved: '你已通过申请加入该团队，无需再次申请',
  rejected: '申请已被拒绝，不能再次申请',
};

/**
 * 通知文案里对用户的称呼：昵称优先，为空时回退到登录名
 * （与消息页私信会话标题的口径一致，避免标题里出现空白的主语）。
 */
function displayName(user: { nickname: string; username: string }): string {
  return user.nickname || user.username;
}

/** 查询申请时统一带出的申请人信息（只给昵称与头像，同发布人卡片） */
const APPLICANT_INCLUDE = {
  applicant: { select: { id: true, nickname: true, avatar: true } },
} satisfies Prisma.TeamApplicationInclude;

type ApplicationWithApplicant = Prisma.TeamApplicationGetPayload<{
  include: typeof APPLICANT_INCLUDE;
}>;

/**
 * 组队申请服务（任务卡 E-2，线②）：申请 → 发帖人审批 → 通过即自动建组入组。
 *
 * 约定：
 *   - 状态机 pending → approved / rejected，不可逆；非法流转一律 409；
 *   - 通过是原子的：申请占位、名额 +1、建组、入组、转「已满员」、通知在同一事务，
 *     任一步失败整体回滚；名额用「条件更新」扣减，并发审批不会超招；
 *   - 审批权限在 service 层按「发帖人本人」判断（不信 JWT roles）；
 *   - 申请与审批不写埋点：发生在课题组之外，无法归属到团队（docs/01）。
 */
@Injectable()
export class CommunityApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teams: TeamsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 申请加入：仅「招募中」的他人帖子；每人每帖至多一条申请 */
  async apply(
    userId: string,
    idParam: string,
    dto: ApplyPostDto,
  ): Promise<ApplicationItem> {
    const post = await requireVisiblePost(this.prisma, idParam);
    const applicantId = BigInt(userId);
    if (post.userId === applicantId) {
      throw BizException.param('不能申请自己的帖子');
    }
    if (post.status === 'full') {
      throw BizException.conflict('帖子已满员');
    }
    if (post.status === 'closed') {
      throw BizException.conflict('帖子已停止招募');
    }

    const existing = await this.prisma.teamApplication.findFirst({
      where: { postId: post.id, userId: applicantId, deleted: 0 },
      select: { status: true },
    });
    if (existing) {
      throw BizException.conflict(
        EXISTING_APPLICATION_MESSAGES[existing.status as ApplicationStatus],
      );
    }
    const applicant = await this.prisma.user.findFirstOrThrow({
      where: { id: applicantId, deleted: 0 },
      select: { nickname: true, username: true },
    });

    let applicationId: bigint;
    try {
      applicationId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.teamApplication.create({
          data: { postId: post.id, userId: applicantId, note: dto.note ?? '' },
          select: { id: true },
        });
        // 通知发帖人，与申请同成同败
        await this.notifications.pushInTransaction(tx, {
          toUserId: post.userId,
          type: 'team_apply',
          title: `${displayName(applicant)} 申请加入你的帖子《${post.title}》`,
          refType: 'community_post',
          refId: post.id,
        });
        return created.id;
      });
    } catch (error) {
      // 并发重复申请由 uk_team_application(post_id, user_id) 兜底
      if (isUniqueViolation(error)) {
        throw BizException.conflict('已申请，请等待发帖人处理');
      }
      throw error;
    }
    return this.requireItem(applicationId);
  }

  /** 该帖的申请列表：仅发帖人可看，按 id 倒序 */
  async list(
    operatorId: string,
    idParam: string,
    query: ListApplicationsQueryDto,
  ): Promise<PageData<ApplicationItem>> {
    const post = await requireVisiblePost(this.prisma, idParam);
    requirePostAuthor(post, operatorId);

    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const where: Prisma.TeamApplicationWhereInput = {
      postId: post.id,
      deleted: 0,
    };
    if (query.status) {
      where.status = query.status;
    }
    const [total, rows] = await Promise.all([
      this.prisma.teamApplication.count({ where }),
      this.prisma.teamApplication.findMany({
        where,
        include: APPLICANT_INCLUDE,
        orderBy: { id: 'desc' },
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

  /** 通过申请：自动建组入组、进度 +1、招满转「已满员」，并通知申请人 */
  async approve(operatorId: string, idParam: string): Promise<HandleResult> {
    return this.handle(operatorId, idParam, 'approved');
  }

  /** 拒绝申请：记录结果并通知申请人，不影响帖子 */
  async reject(operatorId: string, idParam: string): Promise<HandleResult> {
    return this.handle(operatorId, idParam, 'rejected');
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 审批共用流程（通过 / 拒绝）。
   *
   * 权限与状态先在事务外校验一次，给出明确的错误码；事务内再用「条件更新」
   * 做原子占位——两个请求并发审批同一条申请时，只有一次能把它从 pending 改走。
   */
  private async handle(
    operatorId: string,
    idParam: string,
    decision: Decision,
  ): Promise<HandleResult> {
    const application = await this.requireApplication(idParam);
    const post = await requireVisiblePost(
      this.prisma,
      application.postId.toString(),
    );
    requirePostAuthor(post, operatorId);
    if (application.status !== 'pending') {
      throw BizException.conflict('该申请已处理');
    }
    if (decision === 'approved' && post.status === 'full') {
      throw BizException.conflict('帖子已满员，无法再通过申请');
    }

    // 通知文案的主语是发帖人的称呼（昵称，为空时回退到登录名）；
    // 申请人的信息随回读的申请一并带出
    const operator = await this.prisma.user.findFirstOrThrow({
      where: { id: post.userId, deleted: 0 },
      select: { nickname: true, username: true },
    });

    return this.prisma.$transaction(async (tx) => {
      // 1) 原子占位：只有仍是 pending 的申请才会被处理
      const claimed = await tx.teamApplication.updateMany({
        where: { id: application.id, status: 'pending', deleted: 0 },
        data: {
          status: decision,
          handledBy: BigInt(operatorId),
          handledAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw BizException.conflict('该申请已处理');
      }

      let inviteCode: string | undefined;
      if (decision === 'approved') {
        // 2) 名额：条件更新，仅当 recruited_count < recruit_total 才 +1。
        //    已停止的帖子仍可消化存量申请（名额内），已满员的上面已拦下。
        const taken = await tx.communityPost.updateMany({
          where: {
            id: post.id,
            deleted: 0,
            status: { in: ['recruiting', 'closed'] },
            recruitedCount: { lt: post.recruitTotal },
          },
          data: { recruitedCount: { increment: 1 } },
        });
        if (taken.count === 0) {
          throw BizException.conflict('帖子已满员，无法再通过申请');
        }

        // 3) 首次通过：自动建组（名称 = 帖子标题，发帖人为组长）并绑定；之后复用同一课题组
        let teamId = post.teamId;
        if (teamId === null) {
          const created = await this.teams.createTeamInTransaction(
            tx,
            post.userId,
            { name: post.title, description: AUTO_TEAM_DESCRIPTION },
          );
          await tx.communityPost.update({
            where: { id: post.id },
            data: { teamId: created.id },
          });
          teamId = created.id;
          // 邀请码只随创建给出一次，交还给组长用于线下拉人
          inviteCode = created.inviteCode;
        }
        await this.teams.ensureMemberInTransaction(
          tx,
          teamId,
          application.userId,
        );

        // 4) 招满转「已满员」；已停止的帖子保持已停止
        const afterIncrement = await tx.communityPost.findFirstOrThrow({
          where: { id: post.id },
        });
        if (
          afterIncrement.recruitedCount >= afterIncrement.recruitTotal &&
          afterIncrement.status === 'recruiting'
        ) {
          await tx.communityPost.update({
            where: { id: post.id },
            data: { status: 'full' },
          });
        }
      }

      // 5) 通知申请人，与业务写入同成同败
      await this.notifications.pushInTransaction(tx, {
        toUserId: application.userId,
        type:
          decision === 'approved'
            ? 'team_apply_approved'
            : 'team_apply_rejected',
        title:
          decision === 'approved'
            ? `${displayName(operator)} 通过了你加入《${post.title}》的申请`
            : `${displayName(operator)} 拒绝了你加入《${post.title}》的申请`,
        refType: 'community_post',
        refId: post.id,
      });

      // 6) 回读处理后的申请与帖子，组装响应
      const handled = await tx.teamApplication.findFirstOrThrow({
        where: { id: application.id },
        include: APPLICANT_INCLUDE,
      });
      const currentPost = await tx.communityPost.findFirstOrThrow({
        where: { id: post.id },
        include: { team: true },
      });
      return {
        application: this.toItem(handled),
        post: {
          recruitedCount: currentPost.recruitedCount,
          recruitTotal: currentPost.recruitTotal,
          status: currentPost.status,
          team: currentPost.team
            ? {
                id: toIdString(currentPost.team.id),
                name: currentPost.team.name,
              }
            : null,
        },
        ...(inviteCode !== undefined ? { inviteCode } : {}),
      };
    });
  }

  /** 路径 id 统一校验：申请不存在、已删除、id 非法一律 404 */
  private async requireApplication(idParam: string) {
    const id = parseId(idParam);
    const application = id
      ? await this.prisma.teamApplication.findFirst({
          where: { id, deleted: 0 },
        })
      : null;
    if (!application) {
      throw BizException.notFound('申请不存在');
    }
    return application;
  }

  /** 按完整关系回读一条申请（申请成功后的返回值） */
  private async requireItem(applicationId: bigint): Promise<ApplicationItem> {
    const row = await this.prisma.teamApplication.findFirstOrThrow({
      where: { id: applicationId, deleted: 0 },
      include: APPLICANT_INCLUDE,
    });
    return this.toItem(row);
  }

  private toItem(row: ApplicationWithApplicant): ApplicationItem {
    return {
      id: toIdString(row.id),
      postId: toIdString(row.postId),
      status: row.status as ApplicationStatus,
      note: row.note,
      createdAt: formatDateTime(row.createdAt),
      handledAt: formatDateTime(row.handledAt),
      applicant: {
        id: toIdString(row.applicant.id),
        nickname: row.applicant.nickname,
        avatar: row.applicant.avatar,
      },
    };
  }
}
