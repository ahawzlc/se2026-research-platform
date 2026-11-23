import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { parseId } from '../common/team-access';
import {
  areFriends,
  findOutgoingFriendship,
  FRIENDSHIP_STATUS,
  listFriendIds,
  listIncomingRequests,
} from '../common/friendship-access';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateFriendRequestDto } from './dto/create-friend-request.dto';

/** 好友条目（好友列表 / 申请列表通用） */
export interface FriendItem {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  publicUid: string;
  bio: string;
}

/** 好友申请条目 */
export interface FriendRequestItem extends FriendItem {
  /** 申请记录 id（同意/拒绝时用） */
  requestId: string;
  /** 申请时间 */
  createdAt: string;
  /** 我是申请方还是接收方 */
  direction: 'incoming' | 'outgoing';
}

/**
 * 好友服务（线③ 卡 E-3）。
 *
 * ## 状态机（与 common/friendship-access 的约定一致）
 *
 *   发起申请 → 写入 (A→B) pending
 *   同意     → 把该行改成 accepted（不另起一行）
 *   拒绝     → 把该行改成 rejected
 *   再次申请 → 复用该行改回 pending
 *
 * ## 通知口径（docs/12 卡 E-3）
 *
 *   - 申请 → 对方收到 `friend_request` 通知；
 *   - 同意 → 申请方收到 `friend_accepted` 通知；
 *   - 拒绝不发通知（静默处理，避免打扰）。
 *
 * **私信未读不进通知铃铛**（铃铛=事件通知，消息页=会话），
 * 故本模块不产生任何私信相关通知。
 */
@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ================================================================ 好友列表

  /**
   * 我的好友列表。
   *
   * 只返回 accepted 关系里的对端；删除好友后双方同时不可见（逻辑删除）。
   */
  async listFriends(userId: string): Promise<{
    list: FriendItem[];
    total: number;
  }> {
    const friendIds = await listFriendIds(this.prisma, BigInt(userId));
    if (friendIds.length === 0) {
      return { list: [], total: 0 };
    }

    const rows = await this.prisma.user.findMany({
      where: { id: { in: friendIds }, deleted: 0 },
      select: {
        id: true,
        username: true,
        nickname: true,
        avatar: true,
        publicUid: true,
        bio: true,
      },
      orderBy: { nickname: 'asc' },
    });

    const list = rows.map((row) => ({
      id: toIdString(row.id),
      username: row.username,
      nickname: row.nickname,
      avatar: row.avatar,
      publicUid: row.publicUid ?? '',
      bio: row.bio,
    }));
    return { list, total: list.length };
  }

  // ================================================================ 申请

  /**
   * 发起好友申请（按 UID）。
   *
   * 状态流转：
   *   - 已是好友 → 409；
   *   - 对方已申请我（存在反向 pending）→ 409，并提示可直接去同意；
   *   - 我之前申请过且被拒（rejected）→ 复用该行改回 pending（可再次申请）；
   *   - 我之前申请过且还在 pending → 409（同一行不可重复申请）；
   *   - 全新 → 新建 pending 行。
   */
  async createRequest(
    userId: string,
    dto: CreateFriendRequestDto,
  ): Promise<FriendRequestItem> {
    const me = BigInt(userId);
    const uid = dto.uid.trim().toUpperCase();

    const peer = await this.prisma.user.findFirst({
      where: { publicUid: uid, deleted: 0 },
    });
    if (!peer) {
      throw BizException.notFound('该 UID 不存在');
    }
    if (peer.id === me) {
      throw BizException.param('不能添加自己为好友');
    }

    const alreadyFriends = await areFriends(this.prisma, me, peer.id);
    if (alreadyFriends) {
      throw BizException.conflict('你们已经是好友了');
    }

    // 反向 pending：对方已经申请过我 → 提示去处理，不要再插一行
    const reverse = await this.prisma.friendship.findFirst({
      where: {
        requesterId: peer.id,
        addresseeId: me,
        deleted: 0,
      },
      select: { id: true, status: true },
    });
    if (reverse && reverse.status === FRIENDSHIP_STATUS.PENDING) {
      throw BizException.conflict(
        '对方已向你发起好友申请，请去「好友申请」处理',
      );
    }

    // 我发起的方向：可能已存在（pending 待处理 / rejected 被拒可复用）
    const outgoing = await findOutgoingFriendship(this.prisma, me, peer.id);
    let requestId: bigint;
    if (outgoing) {
      if (outgoing.status === FRIENDSHIP_STATUS.PENDING) {
        throw BizException.conflict('好友申请已发出，等待对方处理');
      }
      // rejected → 复用同一行改回 pending（唯一键不允许插第二行）
      await this.prisma.friendship.update({
        where: { id: outgoing.id },
        data: {
          status: FRIENDSHIP_STATUS.PENDING,
          handledAt: null,
          deleted: 0,
        },
      });
      requestId = outgoing.id;
    } else {
      const created = await this.prisma.friendship.create({
        data: {
          requesterId: me,
          addresseeId: peer.id,
          status: FRIENDSHIP_STATUS.PENDING,
        },
        select: { id: true },
      });
      requestId = created.id;
    }

    // 通知对方（通知失败不回滚申请——申请已落库，铃铛轮询可兜底）
    await this.pushSafely({
      toUserId: peer.id.toString(),
      type: 'friend_request',
      title: `${this.displayName(peer.nickname, peer.username)} 请求加你为好友`,
      refType: 'friendship',
      refId: requestId,
    });

    return {
      requestId: requestId.toString(),
      id: toIdString(peer.id),
      username: peer.username,
      nickname: peer.nickname,
      avatar: peer.avatar,
      publicUid: peer.publicUid ?? '',
      bio: peer.bio,
      createdAt: formatDateTime(new Date()),
      direction: 'outgoing',
    };
  }

  /**
   * 同意好友申请。
   *
   * 把那行 pending 直接改成 accepted；通知申请方。
   */
  async acceptRequest(
    userId: string,
    requestIdParam: string,
  ): Promise<FriendItem> {
    const requestId = parseId(requestIdParam);
    if (requestId === null) {
      throw BizException.notFound('好友申请不存在');
    }
    const me = BigInt(userId);

    const row = await this.prisma.friendship.findFirst({
      where: { id: requestId, deleted: 0 },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            publicUid: true,
            bio: true,
          },
        },
      },
    });
    if (!row || row.addresseeId !== me) {
      throw BizException.notFound('好友申请不存在');
    }
    if (row.status === FRIENDSHIP_STATUS.ACCEPTED) {
      // 幂等：已同意过直接返回好友信息
      return this.toFriendItem(row.requester);
    }
    if (row.status !== FRIENDSHIP_STATUS.PENDING) {
      throw BizException.conflict('该申请已被处理');
    }

    await this.prisma.friendship.update({
      where: { id: row.id },
      data: { status: FRIENDSHIP_STATUS.ACCEPTED, handledAt: new Date() },
    });

    await this.pushSafely({
      toUserId: row.requesterId.toString(),
      type: 'friend_accepted',
      title: `${this.displayName(
        row.requester.nickname,
        row.requester.username,
      )} 已同意你的好友申请`,
      refType: 'friendship',
      refId: row.id,
    });

    return this.toFriendItem(row.requester);
  }

  /**
   * 拒绝好友申请。
   *
   * 把那行改成 rejected——**不删行**，因为唯一键 uk_friendship 挡住同方向重复申请，
   * 删了会导致对方再次申请时插第二行、产生脏数据。
   * 被拒的一方之后可以再次发起（复用该行改回 pending）。
   */
  async rejectRequest(userId: string, requestIdParam: string): Promise<void> {
    const requestId = parseId(requestIdParam);
    if (requestId === null) {
      throw BizException.notFound('好友申请不存在');
    }
    const me = BigInt(userId);

    const row = await this.prisma.friendship.findFirst({
      where: { id: requestId, deleted: 0 },
      select: { id: true, addresseeId: true, status: true },
    });
    if (!row || row.addresseeId !== me) {
      throw BizException.notFound('好友申请不存在');
    }
    if (row.status === FRIENDSHIP_STATUS.ACCEPTED) {
      throw BizException.conflict('已是好友，不能拒绝');
    }
    if (row.status === FRIENDSHIP_STATUS.REJECTED) {
      return; // 幂等
    }

    await this.prisma.friendship.update({
      where: { id: row.id },
      data: { status: FRIENDSHIP_STATUS.REJECTED, handledAt: new Date() },
    });
    // 拒绝不发通知（静默处理）
  }

  // ================================================================ 申请列表

  /**
   * 好友申请列表。
   *
   * incoming = 对方申请我（待我处理）；outgoing = 我申请对方（待对方处理）。
   */
  async listRequests(userId: string): Promise<{
    incoming: FriendRequestItem[];
    outgoing: FriendRequestItem[];
  }> {
    const me = BigInt(userId);

    const incomingRows = await listIncomingRequests(this.prisma, me);
    const incoming: FriendRequestItem[] = incomingRows.map((row) => ({
      requestId: row.id,
      id: row.requester.id,
      username: row.requester.username,
      nickname: row.requester.nickname,
      avatar: row.requester.avatar,
      publicUid: '',
      bio: row.requester.bio,
      createdAt: formatDateTime(new Date(row.createdAt)),
      direction: 'incoming',
    }));

    const outgoingRows = await this.prisma.friendship.findMany({
      where: {
        requesterId: me,
        status: FRIENDSHIP_STATUS.PENDING,
        deleted: 0,
      },
      include: {
        addressee: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true,
            publicUid: true,
            bio: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const outgoing: FriendRequestItem[] = outgoingRows.map((row) => ({
      requestId: row.id.toString(),
      id: toIdString(row.addressee.id),
      username: row.addressee.username,
      nickname: row.addressee.nickname,
      avatar: row.addressee.avatar,
      publicUid: row.addressee.publicUid ?? '',
      bio: row.addressee.bio,
      createdAt: formatDateTime(row.createdAt),
      direction: 'outgoing',
    }));

    return { incoming, outgoing };
  }

  // ================================================================ 删除好友

  /**
   * 删除好友（逻辑删除）。
   *
   * 双方同时不可见：把两人之间所有关系行（含 pending / rejected）一并置 deleted=1。
   * 保留行而不是物理删除，是为了不破坏"同一对用户至多一行"的不变式——
   * 物理删除后再次申请会插新行，与历史行并存易产生脏数据。
   */
  async removeFriend(userId: string, friendIdParam: string): Promise<void> {
    const friendId = parseId(friendIdParam);
    if (friendId === null) {
      throw BizException.notFound('好友不存在');
    }
    const me = BigInt(userId);

    const friends = await areFriends(this.prisma, me, friendId);
    if (!friends) {
      throw BizException.notFound('好友不存在');
    }

    await this.prisma.friendship.updateMany({
      where: {
        deleted: 0,
        OR: [
          { requesterId: me, addresseeId: friendId },
          { requesterId: friendId, addresseeId: me },
        ],
      },
      data: { deleted: 1 },
    });
  }

  // ================================================================ 内部

  private toFriendItem(user: {
    id: bigint;
    username: string;
    nickname: string;
    avatar: string;
    publicUid: string | null;
    bio: string;
  }): FriendItem {
    return {
      id: toIdString(user.id),
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      publicUid: user.publicUid ?? '',
      bio: user.bio,
    };
  }

  private displayName(nickname: string, username: string): string {
    return nickname || username;
  }

  /**
   * 推送通知，但不因通知失败而让整个请求失败。
   *
   * 好友申请本身已经落库，通知只是提醒；若通知推送异常，
   * 用户仍能在「好友申请」页看到申请，不该因为提醒失败而丢失申请。
   */
  private async pushSafely(input: {
    toUserId: string;
    type: 'friend_request' | 'friend_accepted';
    title: string;
    refType: 'friendship';
    refId: bigint;
  }): Promise<void> {
    try {
      await this.notifications.push(input);
    } catch {
      // 通知失败不阻断主流程（好友申请已落库）
    }
  }
}
