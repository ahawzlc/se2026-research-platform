/**
 * 课题组访问校验工具（任务卡 B 线共用）。
 *
 * 背景（红线 9）：所有涉及课题组/项目数据的查询都必须带团队标识条件，
 * 防止越权访问他人数据。令牌里的 roles 只是签发时的快照，
 * 不能作为最终权限依据——本项目的一切权限判断都回查 team_member 表。
 *
 * 这些方法在多个业务模块间复用，因此放在 common 层而不是某个业务模块里。
 */

import { PrismaService } from '../prisma/prisma.service';
import { BizException } from './result';

/** 课题组内的角色 */
export type TeamRole = 'owner' | 'admin' | 'member';

/** 成员校验的最低角色要求（按权限从高到低） */
const ROLE_RANK: Record<TeamRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** 校验结果：成员记录 + 角色 */
export interface TeamMembership {
  teamId: bigint;
  userId: bigint;
  role: TeamRole;
}

/**
 * 校验用户是课题组有效成员；不是则抛 403。
 *
 * 注意：这里只查 team_member，不校验课题组自身是否被软删除——
 * 调用方若需要课题组有效状态，应另行查 team 表。
 */
export async function requireTeamMembership(
  prisma: PrismaService,
  teamId: bigint,
  userId: string,
): Promise<TeamMembership> {
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: toBigInt(userId), deleted: 0 },
    select: { teamId: true, userId: true, role: true },
  });
  if (!membership) {
    throw BizException.forbidden('不是该课题组的成员，无权访问');
  }
  return {
    teamId: membership.teamId,
    userId: membership.userId,
    role: membership.role as TeamRole,
  };
}

/**
 * 校验用户是课题组有效成员，且角色不低于 required。
 * 角色不足抛 403（越权），角色够则返回成员记录。
 */
export async function requireTeamRole(
  prisma: PrismaService,
  teamId: bigint,
  userId: string,
  required: TeamRole,
): Promise<TeamMembership> {
  const membership = await requireTeamMembership(prisma, teamId, userId);
  if (ROLE_RANK[membership.role] < ROLE_RANK[required]) {
    throw BizException.forbidden('没有操作权限');
  }
  return membership;
}

/**
 * 列出用户加入的全部课题组 id。
 *
 * 用于「只能看到本组数据」的过滤：where: { teamId: { in: teamIds } }。
 * 用户没有加入任何课题组时返回空数组，调用方据此返回空列表而非报错。
 */
export async function listUserTeamIds(
  prisma: PrismaService,
  userId: string,
): Promise<bigint[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId: toBigInt(userId), deleted: 0 },
    select: { teamId: true },
  });
  return [...new Set(memberships.map((item) => item.teamId))];
}

/** 路径参数 id 统一校验：非纯数字返回 null，由调用方按 404 处理 */
export function parseId(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

/** 把可能为空的 id 参数转成 bigint，非法值直接抛 400 */
export function requireId(value: string, message = 'id 非法'): bigint {
  const id = parseId(value);
  if (id === null) {
    throw BizException.param(message);
  }
  return id;
}

function toBigInt(value: string): bigint {
  return BigInt(value);
}
