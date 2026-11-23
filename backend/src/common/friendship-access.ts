/**
 * 好友关系访问工具（线③ 卡 E-3）。
 *
 * 背景（红线 9）：好友列表/主页可见性判断必须回查 friendship 表，
 * 不能靠前端传参或令牌快照判断。
 *
 * ## friendship 表的数据模型（G-0 已建，本卡只读不改结构）
 *
 * ```sql
 * uk_friendship (requester_id, addressee_id)   -- 唯一键
 * ```
 *
 * **注意这个唯一键是有方向的**：`uk_friendship(A, B)` 与 `uk_friendship(B, A)`
 * 是两个不同的键。也就是说，若 A 申请过 B、B 又申请过 A，**会落两行**——
 * 表结构允许，但业务上不应出现（否则「是否好友」要同时看两个方向，
 * 且任一方向被软删后另一个方向还活着，状态会打架）。
 *
 * ## 本卡定的规则：**一对用户只有一行**
 *
 * 每次发起申请前，先用 `listFriendshipsBetween` 查**双向**（(A,B) 与 (B,A) 都要查），
 * 命中就复用那一行；没命中才 create。于是：
 *
 * - 一对用户在任何时刻**至多存在一行**（不变量）；
 * - 该行的 `requester_id / addressee_id` 记录的是**当前这次申请的方向**
 *   （发起方 / 接收方），状态流转不改变方向语义：
 *   ```
 *   发起申请 → 该行 status=pending（若原本不存在则新建，requester=发起方）
 *   同意     → status=accepted（不新起一行）
 *   拒绝     → status=rejected
 *   再次申请 → 复用该行：status=pending + deleted=0，方向改为新的发起方
 *   删除好友 → 该行 deleted=1（逻辑删除，双方同时不可见）
 *   ```
 * - 「A 与 B 是好友」= 存在一行 `status=accepted` 且
 *   `(requester=A 且 addressee=B)` 或 `(requester=B 且 addressee=A)`。
 *
 * ## 与逻辑删除的交互（真库集成测试踩过的坑）
 *
 * `uk_friendship` **不区分 `deleted`**——逻辑删除只是把 `deleted` 置 1，
 * 行还在、键还占着。故：
 * - 查找复用行时**不能**按 `deleted: 0` 过滤，否则把已软删的行当成「没有行」
 *   → 去 create 新行 → 撞唯一约束（500）。删除好友后就再也加不回来。
 * - 但若两方向各有一行（一行已删、一行活着），优先用**活着**的那行。
 * - **翻转方向**（把旧行改成「我 → 对方」）前，必须**物理删除**反向的重复行：
 *   若把反向行也翻转成 (我, 对方)，就会与保留行撞 `uk_friendship(我, 对方)`（P2002）。
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

/** friendship 一行的关键字段 */
export interface FriendshipRow {
  id: bigint;
  requesterId: bigint;
  addresseeId: bigint;
  status: string;
  deleted: number;
}

/**
 * 列出两人之间的**全部**关系行（双向，含软删行）。
 *
 * 用于「收敛重复行」：历史数据或方向翻转可能留下两行，
 * 同一对用户最终只应保留一行（见文件头不变式）。
 *
 * **不按 `deleted` 过滤**——软删行仍然占着唯一键 `uk_friendship`，
 * 忽略它会导致「删除好友后重新加」时 create 撞约束。
 */
export async function listFriendshipsBetween(
  prisma: PrismaService,
  userA: bigint,
  userB: bigint,
): Promise<FriendshipRow[]> {
  return prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userA, addresseeId: userB },
        { requesterId: userB, addresseeId: userA },
      ],
    },
    select: {
      id: true,
      requesterId: true,
      addresseeId: true,
      status: true,
      deleted: true,
    },
    orderBy: { id: 'asc' },
  });
}

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
