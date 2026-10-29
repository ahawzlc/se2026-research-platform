import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Team, TeamMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, ErrorCode } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { isUniqueViolation } from '../common/prisma-errors';
import type { CreateTeamDto } from './dto/create-team.dto';
import type { JoinTeamDto } from './dto/join-team.dto';
import type { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import type { ListMembersQueryDto } from './dto/list-members.query';

/** 邀请码字母表：大写字母 + 数字，去掉易混淆的 I / L / O / 0 / 1 */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;
/** 生成碰撞（撞 uk_team_invite_code）时的重试上限，31^8 组合下几乎不会触发 */
const INVITE_MAX_RETRY = 3;

/** 建组返回：邀请码只在建组与组长查看时给出 */
export interface CreatedTeam {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  ownerId: string;
  createdAt: string;
}

/** 「我的课题组」条目 */
export interface MyTeamItem {
  id: string;
  name: string;
  description: string;
  role: string;
  joinedAt: string;
}

/** 成员条目（绝不含 passwordHash） */
export interface TeamMemberItem {
  userId: string;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
  role: string;
  joinedAt: string;
}

/**
 * 课题组服务（任务卡 A-2）。
 *
 * 约定：
 *   - 建组 / 入组不产生埋点（红线 8：ActivityType 固定 9 类，无对应类型）；
 *   - 权限按 team_member 表逐组校验，令牌里的 roles 只是快照，不作为依据；
 *   - 所有查询显式带 deleted: 0（红线 5）。
 */
@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 建组：team 与组长记录同一事务写入，任一失败整体回滚 */
  async createTeam(userId: string, dto: CreateTeamDto): Promise<CreatedTeam> {
    const ownerId = BigInt(userId);
    for (let attempt = 1; attempt <= INVITE_MAX_RETRY; attempt++) {
      const inviteCode = this.generateInviteCode();
      try {
        const team = await this.prisma.$transaction(async (tx) => {
          const created = await tx.team.create({
            data: {
              name: dto.name,
              description: dto.description ?? '',
              ownerId,
              inviteCode,
            },
          });
          await tx.teamMember.create({
            data: { teamId: created.id, userId: ownerId, role: 'owner' },
          });
          return created;
        });
        return this.toCreatedTeam(team);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // 邀请码撞唯一索引，换一个重来
      }
    }
    throw new BizException(ErrorCode.INTERNAL, '邀请码生成失败，请重试');
  }

  /** 凭邀请码入组；曾退出（软删）的成员恢复身份而不是新增行 */
  async join(userId: string, dto: JoinTeamDto): Promise<MyTeamItem> {
    const team = await this.prisma.team.findFirst({
      where: { inviteCode: dto.inviteCode, deleted: 0 },
    });
    if (!team) {
      throw BizException.notFound('邀请码无效');
    }

    const memberId = BigInt(userId);
    const existing = await this.prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: memberId },
    });
    if (!existing) {
      try {
        await this.prisma.teamMember.create({
          data: { teamId: team.id, userId: memberId, role: 'member' },
        });
      } catch (error) {
        // 并发入组时唯一索引兜底
        if (isUniqueViolation(error)) {
          throw BizException.conflict('已在课题组中');
        }
        throw error;
      }
    } else if (existing.deleted === 1) {
      // uk_team_member(team_id, user_id) 不过滤软删行，退出后重入必须复用原行
      await this.prisma.teamMember.update({
        where: { id: existing.id },
        data: { deleted: 0, role: 'member' },
      });
    } else {
      throw BizException.conflict('已在课题组中');
    }

    return this.toMyTeamItem(team, 'member', new Date());
  }

  /** 当前用户加入的课题组（组本身已删的不再返回） */
  async myTeams(userId: string): Promise<MyTeamItem[]> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: BigInt(userId), deleted: 0 },
      include: { team: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships
      .filter((item) => item.team.deleted === 0)
      .map((item) => this.toMyTeamItem(item.team, item.role, item.createdAt));
  }

  /** 成员列表：仅本组成员可看（红线 9：查询必须带团队归属校验） */
  async listMembers(
    teamIdParam: string,
    userId: string,
    query: ListMembersQueryDto,
  ) {
    const teamId = this.parseId(teamIdParam);
    const team = teamId
      ? await this.prisma.team.findFirst({ where: { id: teamId, deleted: 0 } })
      : null;
    if (!team) {
      throw BizException.notFound('课题组不存在');
    }
    await this.requireMembership(team.id, userId);

    const page = query.page ?? 1;
    const size = query.size ?? 50;
    const where = { teamId: team.id, deleted: 0 };
    const [total, rows] = await Promise.all([
      this.prisma.teamMember.count({ where }),
      this.prisma.teamMember.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return {
      list: rows.map((row) => this.toMemberItem(row)),
      total,
      page,
      size,
    };
  }

  /** 修改成员角色：仅组长可操作；组长本人的角色不在此修改 */
  async updateMemberRole(
    teamIdParam: string,
    operatorId: string,
    targetUserIdParam: string,
    dto: UpdateMemberRoleDto,
  ): Promise<TeamMemberItem> {
    const teamId = this.parseId(teamIdParam);
    const team = teamId
      ? await this.prisma.team.findFirst({ where: { id: teamId, deleted: 0 } })
      : null;
    if (!team) {
      throw BizException.notFound('课题组不存在');
    }

    const operator = await this.requireMembership(team.id, operatorId);
    if (operator.role !== 'owner') {
      throw BizException.forbidden('仅组长可修改成员角色');
    }

    const targetUserId = this.parseId(targetUserIdParam);
    const target = targetUserId
      ? await this.prisma.teamMember.findFirst({
          where: { teamId: team.id, userId: targetUserId, deleted: 0 },
        })
      : null;
    if (!target) {
      throw BizException.notFound('该用户不是课题组成员');
    }
    if (target.role === 'owner') {
      throw BizException.param('不能修改组长的角色');
    }

    await this.prisma.teamMember.update({
      where: { id: target.id },
      data: { role: dto.role },
    });
    const updated = await this.prisma.teamMember.findFirst({
      where: { id: target.id },
      include: { user: true },
    });
    // update 与 findFirst 之间行不会消失（本接口无删除路径），防御性兜底
    if (!updated) {
      throw BizException.notFound('该用户不是课题组成员');
    }
    return this.toMemberItem(updated);
  }

  // ---------------------------------------------------------------- 内部

  /** 生成 8 位无混淆字符的随机邀请码 */
  private generateInviteCode(): string {
    const bytes = randomBytes(INVITE_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
    }
    return code;
  }

  /** 路径 id 统一校验：非数字返回 null，由调用方按 404 处理 */
  private parseId(value: string): bigint | null {
    return /^\d+$/.test(value) ? BigInt(value) : null;
  }

  /** 校验用户是该组成员，返回成员记录；不是则 403 */
  private async requireMembership(
    teamId: bigint,
    userId: string,
  ): Promise<TeamMember> {
    const membership = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: BigInt(userId), deleted: 0 },
    });
    if (!membership) {
      throw BizException.forbidden('不是该课题组的成员，无权访问');
    }
    return membership;
  }

  private toCreatedTeam(team: Team): CreatedTeam {
    return {
      id: toIdString(team.id),
      name: team.name,
      description: team.description,
      inviteCode: team.inviteCode,
      ownerId: toIdString(team.ownerId),
      createdAt: formatDateTime(team.createdAt),
    };
  }

  private toMyTeamItem(team: Team, role: string, joinedAt: Date): MyTeamItem {
    return {
      id: toIdString(team.id),
      name: team.name,
      description: team.description,
      role,
      joinedAt: formatDateTime(joinedAt),
    };
  }

  private toMemberItem(
    row: TeamMember & {
      user: {
        username: string;
        nickname: string;
        avatar: string;
        email: string;
      };
    },
  ): TeamMemberItem {
    return {
      userId: toIdString(row.userId),
      username: row.user.username,
      nickname: row.user.nickname,
      avatar: row.user.avatar,
      email: row.user.email,
      role: row.role,
      joinedAt: formatDateTime(row.createdAt),
    };
  }
}
