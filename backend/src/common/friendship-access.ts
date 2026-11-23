/**
 * 好友关系访问工具（线③ 卡 E-3）。
 *
 * 背景（红线 9）：好友列表/主页可见性判断必须回查 friendship 表，
 * 不能靠前端传参或令牌快照判断。
 *
 * ## friendship 表的数据模型（G-0 已建，本卡只读不改结构）
 *
 * 单向行表示一条关系：requester 发起方、addressee 接收方，
 * 唯一键 uk_friendship(requester_id, addressee_id) 挡住重复申请。
 *
 * **本卡对状态机的约定**（与 G-0 建表注释一致）：
 *   - 发起申请：写入/复用一行 (A→B)，status=pending；
 *   - 同意：**把那一行 pending 直接改成 accepted**，不另起一行——
 *     否则同一对用户会出现 pending/accepted 两行，判定"是否好友"时要同时看两个方向，
 *     容易出现"两边都 accepted"的脏状态；
 *   - 拒绝：同一行改成 rejected；对方可再次发起，复用该行改回 pending
 *     （这正是 G-0 注释里"可再次发起：复用本行改回 pending"的意思）。
 *
 * 由此，「A 与 B 是好友」= 存在一行 status=accepted 且
 * (requester=A 且 addressee=B) 或 (requester=B 且 addressee=A)。
 *
 * **不变式**：同一对用户至多存在一行 accepted。
 *   服务层在「发起申请」前会先查 areFriends，已是好友则拒绝再次申请，
 *   从而保证不会同时存在 (A→B) 与 (B→A) 两行 accepted。
 */

import { PrismaService } from '../prisma/prisma.service';

/** 好友关系状态（与 friendship.status 列注释一致） */
export const FRIENDSHIP_STATUS = {
  /** 待对方同意 */
  PENDING: 'pending',
  /** 已互为好友 */
  ACCEPTED: 'accepted',
  /** 已拒绝（可再次发起：复用本行改回 pending） */
  REJECTED: 'rejected',
} as const;

export type FriendshipStatus =
  (typeof FRIENDSHIP_STATUS)[keyof typeof FRIENDSHIP_STATUS];

/** 判定双方是否已互为好友（accepted 且双向任一方向命中） */
export async function areFriends(
  prisma: PrismaService,
  userA: bigint,
  userB: bigint,
): Promise<boolean> {
  const row = await prisma.friendship.findFirst({
    where: {
      deleted: 0,
      status: FRIENDSHIP_STATUS.ACCEPTED,
      OR: [
        { requesterId: userA, addresseeId: userB },
        { requesterId: userB, addresseeId: userA },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * 查询两人之间「我 → 对方」方向的那条关系（申请方是我）。
 *
 * 用于「我是否已申请过对方」的判定；拒绝后可再次申请（复用同一行改回 pending）。
 */
export async function findOutgoingFriendship(
  prisma: PrismaService,
  requesterId: bigint,
  addresseeId: bigint,
): Promise<{ id: bigint; status: string } | null> {
  const row = await prisma.friendship.findFirst({
    where: { requesterId, addresseeId, deleted: 0 },
    select: { id: true, status: true },
  });
  return row ? { id: row.id, status: row.status } : null;
}

/**
 * 查询「我作为接收方」的待处理申请（对方申请加我、我还没同意）。
 */
export async function listIncomingRequests(
  prisma: PrismaService,
  addresseeId: bigint,
): Promise<
  Array<{
    id: string;
    status: string;
    createdAt: string;
    requester: {
      id: string;
      username: string;
      nickname: string;
      avatar: string;
      bio: string;
    };
  }>
> {
  const rows = await prisma.friendship.findMany({
    where: {
      addresseeId,
      requesterId: { not: addresseeId },
      status: FRIENDSHIP_STATUS.PENDING,
      deleted: 0,
    },
    include: {
      requester: {
        select: {
          id: true,
          username: true,
          nickname: true,
          avatar: true,
          bio: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    requester: {
      id: row.requester.id.toString(),
      username: row.requester.username,
      nickname: row.requester.nickname,
      avatar: row.requester.avatar,
      bio: row.requester.bio,
    },
  }));
}

/**
 * 列出我已接受的好友 id（互为好友状态）。
 *
 * accepted 行可能以我为 requester 或 addressee，两个方向都要覆盖；
 * 对端 id 取"不是我的那一端"。
 */
export async function listFriendIds(
  prisma: PrismaService,
  userId: bigint,
): Promise<bigint[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: FRIENDSHIP_STATUS.ACCEPTED,
      deleted: 0,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });

  const ids = rows.map((row) =>
    row.requesterId === userId ? row.addresseeId : row.requesterId,
  );
  return [...new Set(ids)];
}
