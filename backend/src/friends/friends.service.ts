import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { parseId } from '../common/team-access';
import {
  areFriends,
  FRIENDSHIP_STATUS,
  listFriendIds,
  listFriendshipsBetween,
  listIncomingRequests,
} from '../common/friendship-access';
import { NotificationsService } from '../notifications/notifications.service';
import { RateLimitService } from '../auth/rate-limit.service';
import {
  FRIEND_REQUEST_COOLDOWN_MS,
  FRIEND_REQUEST_DAILY_LIMIT,
  FRIEND_REQUEST_DAY_MS,
  FRIEND_REQUEST_WINDOW_MS,
} from './friends.constants';
import type { CreateFriendRequestDto } from './dto/create-friend-request.dto';

/** 好友条目（好友列表 / 申请列表通用） */
export interface FriendItem {
  id: string;
  /**
   * 登录名。
   *
   * **不返回**（评审意见 C2②）：引入 UID 的理由之一就是「登录名不愿被展示」，
   * 好友列表 / 申请列表都可能被他人看到，故一律不带 username。
   * 前端用 `nickname || publicUid` 兜底展示。
   */
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
    private readonly rateLimit: RateLimitService,
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
        nickname: true,
        avatar: true,
        publicUid: true,
        bio: true,
      },
      orderBy: { nickname: 'asc' },
    });

    const list = rows.map((row) => ({
      id: toIdString(row.id),
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
   * ## 一对用户只允许存在一行（关键不变式）
   *
   * `uk_friendship (requester_id, addressee_id)` 是**有方向**的唯一键，
   * 所以 A→B 与 B→A 是两个不同的键。若不加约束地 create，
   * 「A 申请 B、B 也申请 A」会落两行，之后双方好友列表会打架、
   * 删除一方后另一行还活着。所以本方法**双向查一次**：
   *
   * ```
   * existing = listFriendshipsBetween(me, peer)   // (A,B) 与 (B,A) 都查
   * ```
   *
   * 命中 → 复用那一行（复活 / 改方向 / 改状态）；未命中 → 才 create。
   *
   * ## 状态流转
   *
   *   - 已是好友 → 409；
   *   - 存在反向 pending（对方已申请我）→ 409，提示去「好友申请」处理；
   *   - 我发起的 pending → 409（同一行不可重复申请）；
   *   - rejected（被拒）→ 复用该行改回 pending；
   *   - deleted=1（我删过这位好友）→ **复活该行**改回 pending。
   *     不能 create 新行：`uk_friendship` 不区分 deleted，新行必撞约束（500）。
   *   - 全新 → 新建 pending 行。
   *
   * 注意「再次申请」时该行的**方向会改为新的发起方**
   * （requester=我、addressee=对方），这样接收方的「待处理申请」列表
   * 才能用 `addresseeId = 我` 查到，同意/拒绝也才有意义。
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

    // 防骚扰 1：被拒冷却期（评审意见 D3）
    // 被对方拒绝后，短期内不允许再向同一人发起申请，
    // 防止「被拒 → 立刻再发」的定向骚扰（拒绝是静默的，对方不会被打扰到）。
    const cooldown = await this.checkCooldown(me, peer.id);
    if (cooldown) {
      throw BizException.conflict(cooldown);
    }

    // 防骚扰 2：每人每天的申请次数上限
    // 挡住「拿到 UID 批量发申请」的机器行为（每发一次都会给对方推一条通知）。
    if (
      !this.rateLimit.hit(
        `friend-request:${me.toString()}`,
        FRIEND_REQUEST_DAILY_LIMIT,
        FRIEND_REQUEST_WINDOW_MS,
      )
    ) {
      throw BizException.param(
        `今日好友申请次数已达上限（${FRIEND_REQUEST_DAILY_LIMIT} 次），请明天再试`,
      );
    }

    // 双向查一次：确保「一对用户至多一行」
    // （`uk_friendship` 是有方向的唯一键，(A,B) 与 (B,A) 是两个不同的键）
    const allRows = await listFriendshipsBetween(this.prisma, me, peer.id);
    const alive = allRows.filter((r) => r.deleted === 0);
    const mine = alive.find(
      (r) => r.requesterId === me && r.addresseeId === peer.id,
    );
    const theirs = alive.find(
      (r) => r.requesterId === peer.id && r.addresseeId === me,
    );

    // 反向 pending：对方已经申请过我 → 提示去处理，不要再插一行
    if (theirs && theirs.status === FRIENDSHIP_STATUS.PENDING) {
      throw BizException.conflict(
        '对方已向你发起好友申请，请去「好友申请」处理',
      );
    }

    // 我发起的 pending → 409（同一行不可重复申请）
    if (mine && mine.status === FRIENDSHIP_STATUS.PENDING) {
      throw BizException.conflict('好友申请已发出，等待对方处理');
    }

    let requestId: bigint;
    if (allRows.length > 0) {
      // 已有关系行 → 复用（唯一键 uk_friendship 不区分 deleted，
      // create 新行必撞约束，故只能复用旧行）
      //
      // 优先保留「活着且是我发起方向」的行；否则取任意活行；
      // 全是软删行则取第一条（旧行复活）。
      const keep = mine ?? theirs ?? alive[0] ?? allRows[0];
      const extras = allRows.filter((r) => r.id !== keep.id);

      // 翻转方向前必须先物理删除反向的重复行：
      // 若反向行还在，把它翻转成 (me,peer) 会撞唯一约束（P2002）。
      await this.prisma.$transaction([
        ...(extras.length > 0
          ? [
              this.prisma.friendship.deleteMany({
                where: { id: { in: extras.map((r) => r.id) } },
              }),
            ]
          : []),
        this.prisma.friendship.update({
          where: { id: keep.id },
          data: {
            requesterId: me,
            addresseeId: peer.id,
            status: FRIENDSHIP_STATUS.PENDING,
            handledAt: null,
            deleted: 0,
          },
        }),
      ]);
      requestId = keep.id;
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
    //
    // 标题里的主语是**发起人**（当前登录用户），不是接收人。
    // 早期版本误用了 peer 的昵称，导致收件人看到「李四 请求加你为好友」
    // 而他自己就是李四（详见 docs/17-线③开发留痕.md 缺陷 A1）。
    const meRow = await this.prisma.user.findFirst({
      where: { id: me, deleted: 0 },
      select: { username: true, nickname: true },
    });
    await this.pushSafely({
      toUserId: peer.id.toString(),
      type: 'friend_request',
      title: `${this.displayName(meRow?.nickname ?? '', meRow?.username ?? '')} 请求加你为好友`,
      refType: 'friendship',
      refId: requestId,
    });

    return {
      requestId: requestId.toString(),
      id: toIdString(peer.id),
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

    // 通知申请方。
    //
    // 标题里的主语是**同意人**（当前登录用户），不是申请方。
    // 早期版本误用了 requester 的昵称，导致申请方看到「李四 已同意你的好友申请」
    // 而他自己就是李四（详见 docs/17-线③开发留痕.md 缺陷 A1）。
    const meRow = await this.prisma.user.findFirst({
      where: { id: me, deleted: 0 },
      select: { username: true, nickname: true },
    });
    await this.pushSafely({
      toUserId: row.requesterId.toString(),
      type: 'friend_accepted',
      title: `${this.displayName(meRow?.nickname ?? '', meRow?.username ?? '')} 已同意你的好友申请`,
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

  /**
   * 撤回我发出的好友申请（评审意见 E4）。
   *
   * 约束：
   *   - 只能撤回**自己**发出的申请（我是 requester）；
   *   - 只能撤回 **pending** 状态的申请（对方已处理的就不能撤了）。
   *
   * 状态流转：pending → rejected。
   *
   * 为什么用 rejected 而不是物理删行 / 新增一个 cancelled 状态：
   *   - 唯一键 `uk_friendship` 不区分 deleted，物理删行会腾出键，
   *     与「一对用户至多一行」的不变式冲突（下次申请会插新行）；
   *   - rejected 是现有状态机里已有的终态，复用它不必改 schema；
   *   - 撤回后仍会受**被拒冷却期**约束（见 friends.constants.ts），
   *     这是有意的：撤回也是一种「对方没接受」的信号，
   *     防止「发申请→被拒→撤回→再发」无限循环骚扰。
   */
  async withdrawRequest(userId: string, requestIdParam: string): Promise<void> {
    const requestId = parseId(requestIdParam);
    if (requestId === null) {
      throw BizException.notFound('好友申请不存在');
    }
    const me = BigInt(userId);

    const row = await this.prisma.friendship.findFirst({
      where: { id: requestId, deleted: 0 },
      select: { id: true, requesterId: true, status: true },
    });
    if (!row || row.requesterId !== me) {
      throw BizException.notFound('好友申请不存在或不是你发出的');
    }
    if (row.status !== FRIENDSHIP_STATUS.PENDING) {
      throw BizException.conflict('该申请已被处理，无法撤回');
    }

    await this.prisma.friendship.update({
      where: { id: row.id },
      data: { status: FRIENDSHIP_STATUS.REJECTED, handledAt: new Date() },
    });
    // 撤回不发通知（对方本来就不需要知道）
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
      nickname: row.requester.nickname,
      avatar: row.requester.avatar,
      publicUid: row.requester.publicUid,
      bio: row.requester.bio,
      createdAt: formatDateTime(row.createdAt),
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
   *
   * 若历史脏数据导致两人之间有两行，则**物理删除多余的那行**：
   * 唯一键不区分 deleted，多余的软删行仍占着键，
   * 后续「重新加好友并翻转方向」会撞 P2002。
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

  /**
   * 被拒冷却期检查（评审意见 D3）。
   *
   * 命中条件：存在一行 `status=rejected` 的关系行，且**我是申请方**。
   * （「一对用户至多一行」的不变式下，被拒的行方向就是当时的申请方向。）
   *
   * @returns 冷却期内返回给用户看的提示（含剩余天数）；不在冷却期返回 null
   */
  private async checkCooldown(
    requesterId: bigint,
    addresseeId: bigint,
  ): Promise<string | null> {
    const rejected = await this.prisma.friendship.findFirst({
      where: {
        deleted: 0,
        status: FRIENDSHIP_STATUS.REJECTED,
        // 我是申请方 → 这一行代表「我的申请被拒了」
        requesterId,
        addresseeId,
      },
      select: { handledAt: true },
    });
    if (!rejected || !rejected.handledAt) {
      return null;
    }

    const elapsed = Date.now() - rejected.handledAt.getTime();
    if (elapsed >= FRIEND_REQUEST_COOLDOWN_MS) {
      return null; // 冷却期已过
    }

    const remainMs = FRIEND_REQUEST_COOLDOWN_MS - elapsed;
    // 剩余天数按「天」向上取整：还剩 2.9 天 → 提示 3 天
    const remainDays = Math.max(1, Math.ceil(remainMs / FRIEND_REQUEST_DAY_MS));
    return `对方刚刚拒绝过你的好友申请，${remainDays} 天内不能再发起申请`;
  }

  private toFriendItem(user: {
    id: bigint;
    nickname: string;
    avatar: string;
    publicUid: string | null;
    bio: string;
  }): FriendItem {
    return {
      id: toIdString(user.id),
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
