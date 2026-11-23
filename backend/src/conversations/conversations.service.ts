import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { parseId, requireTeamMembership } from '../common/team-access';
import { areFriends } from '../common/friendship-access';
import type {
  CreateGroupConversationDto,
  CreatePrivateConversationDto,
} from './dto/conversation.dto';
import type { ListConversationsQueryDto } from './dto/conversation-query.dto';

/** 会话类型（docs/02 conversation.type） */
export type ConversationType = 'comment' | 'group' | 'private';

/** 对外暴露的消息条目 */
export interface MessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  msgType: string;
  createdAt: string;
}

/** 会话列表条目（含最后一条消息与未读数） */
export interface ConversationItem {
  id: string;
  type: string;
  title: string;
  refType: string;
  refId: string;
  /** 最后一条消息预览；无消息时为空串 */
  lastMessage: string;
  lastMessageAt: string;
  /** 未读数（comment 类型恒为 0） */
  unreadCount: number;
  updatedAt: string;
}

/** 未读汇总条目 */
export interface UnreadItem {
  conversationId: string;
  unreadCount: number;
}

/**
 * 会话服务（统一会话模型）。
 *
 * B-3 任务评论与 C-5 协作消息共用本服务：
 *   - B-3 复用锚定评论（comment）：ensureAnchorConversation + postMessage；
 *   - C-5 补充 group / private 会话、未读汇总、标记已读；
 *   - 线③ 卡 E-3 调整 private 会话的可见性与发言限制。
 *
 * **消息零埋点**：docs/03 明确消息不计入参与度，本服务不写 activity_log。
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ================================================================ B-3

  /**
   * 取得（或创建）锚定在业务对象上的会话。
   *
   * 并发场景下两个请求可能同时创建锚定会话，
   * 因此捕获唯一索引冲突后回查已存在的那一条。
   */
  async ensureAnchorConversation(
    type: ConversationType,
    refType: string,
    refId: bigint,
    title?: string,
  ): Promise<bigint> {
    const existing = await this.prisma.conversation.findFirst({
      where: { type, refType, refId, deleted: 0 },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    try {
      const created = await this.prisma.conversation.create({
        data: {
          type,
          refType,
          refId,
          title: title ?? null,
        },
        select: { id: true },
      });
      return created.id;
    } catch {
      // 并发创建时唯一索引兜底：回查已存在的那条
      const retry = await this.prisma.conversation.findFirst({
        where: { type, refType, refId, deleted: 0 },
        select: { id: true },
      });
      if (!retry) {
        throw BizException.internal('创建会话失败，请重试');
      }
      return retry.id;
    }
  }

  /** 把用户加入会话（用于会话成员与已读位点） */
  async ensureMember(conversationId: bigint, userId: bigint): Promise<void> {
    const existing = await this.prisma.conversationMember.findFirst({
      where: { conversationId, userId },
      select: { id: true, deleted: true },
    });
    if (!existing) {
      await this.prisma.conversationMember.create({
        data: { conversationId, userId },
      });
      return;
    }
    if (existing.deleted === 1) {
      await this.prisma.conversationMember.update({
        where: { id: existing.id },
        data: { deleted: 0 },
      });
    }
  }

  /** 读取会话内的消息（倒序取 limit 条后正序返回） */
  async listMessages(
    conversationId: bigint,
    limit: number,
  ): Promise<MessageItem[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, deleted: 0 },
      include: { sender: { select: { username: true, nickname: true } } },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.reverse().map((row) => ({
      id: toIdString(row.id),
      conversationId: toIdString(row.conversationId),
      senderId: toIdString(row.senderId),
      senderName: row.sender.nickname || row.sender.username,
      content: row.content ?? '',
      msgType: row.msgType,
      createdAt: formatDateTime(row.createdAt),
    }));
  }

  /** 向会话发送一条消息（B-3 用；C-5 用 sendConversationMessage 替代） */
  async postMessage(
    conversationId: bigint,
    senderId: bigint,
    content: string,
    msgType = 'text',
  ): Promise<MessageItem> {
    await this.ensureMember(conversationId, senderId);
    const row = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        msgType,
      },
      include: { sender: { select: { username: true, nickname: true } } },
    });
    return {
      id: toIdString(row.id),
      conversationId: toIdString(row.conversationId),
      senderId: toIdString(row.senderId),
      senderName: row.sender.nickname || row.sender.username,
      content: row.content ?? '',
      msgType: row.msgType,
      createdAt: formatDateTime(row.createdAt),
    };
  }

  // ================================================================ C-5

  /** 会话列表：当前用户参与的所有会话，按 updatedAt 倒序，含未读数 */
  async listConversations(
    userId: string,
    query: ListConversationsQueryDto,
  ): Promise<{
    list: ConversationItem[];
    total: number;
    page: number;
    size: number;
  }> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const where: Prisma.ConversationWhereInput = {
      deleted: 0,
      members: { some: { userId: BigInt(userId), deleted: 0 } },
    };
    if (query.type) {
      where.type = query.type;
    }

    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          members: {
            where: { userId: BigInt(userId), deleted: 0 },
            select: { lastReadAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    const items = await Promise.all(
      rows.map((row) => this.toConversationItem(row)),
    );
    await this.fillPrivateTitles(userId, items);
    return { list: items, total, page, size };
  }

  /** 创建/获取项目讨论区：一个项目一个 group 会话 */
  async ensureGroupConversation(
    userId: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationItem> {
    const projectId = parseId(dto.projectId);
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

    const conversationId = await this.ensureAnchorConversation(
      'group',
      'project',
      project.id,
      `项目「${project.name}」讨论区`,
    );
    await this.ensureMember(conversationId, BigInt(userId));

    return this.detailConversation(userId, conversationId.toString());
  }

  /**
   * 创建/获取私信会话（线③ 卡 E-3 调整了权限口径）。
   *
   * **旧口径**：双方必须在同一课题组（docs/09 原红线 9 的过严版本）。
   * **新口径**（本卡明确决策，用户 2026-11-23 拍板）：
   *   - 任何登录用户都可以给任何其他登录用户发私信——不再要求同组，
   *     因为"通过 UID 加好友→私信"是本卡的核心链路，若强制同组则加好友无意义；
   *   - 但**非好友之间限制发言**：同一对非好友的私信会话里，
   *     每个方向最多发 1 条（首次打招呼模式）；成为好友后解除限制。
   *
   * 这样既满足"任何人可发起搭话"，又避免陌生人刷屏骚扰。
   */
  async ensurePrivateConversation(
    userId: string,
    dto: CreatePrivateConversationDto,
  ): Promise<ConversationItem> {
    const peerId = parseId(dto.peerUserId);
    if (peerId === null || peerId === BigInt(userId)) {
      throw BizException.param('peerUserId 非法');
    }

    // 对方必须是真实存在的用户
    const peer = await this.prisma.user.findFirst({
      where: { id: peerId, deleted: 0 },
      select: { id: true },
    });
    if (!peer) {
      throw BizException.notFound('用户不存在');
    }

    // 查是否已有双方都在的 private 会话
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'private',
        deleted: 0,
        AND: [
          { members: { some: { userId: BigInt(userId), deleted: 0 } } },
          { members: { some: { userId: peerId, deleted: 0 } } },
        ],
      },
      select: { id: true },
    });

    let conversationId: bigint;
    if (existing) {
      conversationId = existing.id;
    } else {
      const created = await this.prisma.conversation.create({
        data: {
          type: 'private',
          title: null,
        },
        select: { id: true },
      });
      conversationId = created.id;
      await this.ensureMember(conversationId, BigInt(userId));
      await this.ensureMember(conversationId, peerId);
    }

    return this.detailConversation(userId, conversationId.toString());
  }

  /**
   * 按 UID 打开/创建与某用户的私信会话（线③ 卡 E-3）。
   *
   * 好友页与个人主页只有对方的 UID（不暴露 user.id），故先解析 UID 再走
   * ensurePrivateConversation 的同一套逻辑，保证两条入口行为一致。
   */
  async openPrivateConversationByUid(
    userId: string,
    uid: string,
  ): Promise<ConversationItem> {
    const normalized = uid.trim().toUpperCase();
    const peer = await this.prisma.user.findFirst({
      where: { publicUid: normalized, deleted: 0 },
      select: { id: true },
    });
    if (!peer) {
      throw BizException.notFound('该 UID 不存在');
    }
    return this.ensurePrivateConversation(userId, {
      peerUserId: peer.id.toString(),
    });
  }

  /** 会话详情（含未读数；仅会话成员可看） */
  async detailConversation(
    userId: string,
    idParam: string,
  ): Promise<ConversationItem> {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('会话不存在');
    }
    const row = await this.prisma.conversation.findFirst({
      where: {
        id,
        deleted: 0,
        members: { some: { userId: BigInt(userId), deleted: 0 } },
      },
      include: {
        members: {
          where: { userId: BigInt(userId), deleted: 0 },
          select: { lastReadAt: true },
        },
      },
    });
    if (!row) {
      throw BizException.notFound('会话不存在');
    }
    const item = await this.toConversationItem(row);
    await this.fillPrivateTitles(userId, [item]);
    return item;
  }

  /**
   * private 会话的展示名对每个查看者不同（对方的名字），共享的 title 列在建会话时
   * 无法写入（双方视角不一样），这里按查看者批量解析并覆盖：
   * 一次 in 查询取列表内全部 private 会话的对方成员，避免逐会话 N+1。
   */
  private async fillPrivateTitles(
    userId: string,
    items: ConversationItem[],
  ): Promise<void> {
    const privateIds = items
      .filter((item) => item.type === 'private')
      .map((item) => BigInt(item.id));
    if (privateIds.length === 0) return;

    const peers = await this.prisma.conversationMember.findMany({
      where: {
        conversationId: { in: privateIds },
        userId: { not: BigInt(userId) },
        deleted: 0,
      },
      select: {
        conversationId: true,
        user: { select: { username: true, nickname: true } },
      },
    });
    const nameByConversation = new Map(
      peers.map((peer) => [
        peer.conversationId.toString(),
        peer.user.nickname || peer.user.username,
      ]),
    );
    for (const item of items) {
      if (item.type === 'private') {
        item.title = nameByConversation.get(item.id) || item.title;
      }
    }
  }

  /** 会话消息列表（带成员权限校验） */
  async listConversationMessages(
    userId: string,
    idParam: string,
    limit?: number,
  ): Promise<MessageItem[]> {
    const conversationId = await this.requireMemberConversation(
      userId,
      idParam,
    );
    return this.listMessages(conversationId, limit ?? 50);
  }

  /**
   * 发消息：写 message + 刷新 conversation.updatedAt + 同步发送者 lastReadAt。
   *
   * **零埋点**：docs/03 明确消息不计入参与度，本方法不写 activity_log。
   *
   * **非好友限流（线③ 卡 E-3）**：private 会话中，若双方不是好友，
   * 则每个方向最多发 1 条（首次打招呼模式）；成为好友后解除限制。
   * 判定依据是「该方向已发出的消息条数」，与群聊/讨论区无关。
   */
  async sendConversationMessage(
    userId: string,
    idParam: string,
    content: string,
  ): Promise<MessageItem> {
    const conversationId = await this.requireMemberConversation(
      userId,
      idParam,
    );
    const senderId = BigInt(userId);

    await this.assertMessageAllowed(conversationId, senderId);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId, senderId, content, msgType: 'text' },
        include: { sender: { select: { username: true, nickname: true } } },
      });

      // 刷新会话的 updatedAt，让列表按最近活动排序
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      // 发送者自己肯定已读，推进已读位点，避免自己给自己算未读
      await tx.conversationMember.updateMany({
        where: { conversationId, userId: senderId, deleted: 0 },
        data: { lastReadAt: new Date() },
      });

      return created;
    });

    return {
      id: toIdString(message.id),
      conversationId: toIdString(message.conversationId),
      senderId: toIdString(message.senderId),
      senderName: message.sender.nickname || message.sender.username,
      content: message.content ?? '',
      msgType: message.msgType,
      createdAt: formatDateTime(message.createdAt),
    };
  }

  /**
   * 非好友发言限制检查（线③ 卡 E-3）。
   *
   * 规则：private 会话中，若发送方与对方不是好友，
   * 则该方向已发出的消息数必须 < 1（即最多 1 条）。
   *
   * 非 private 会话（group / comment / meeting）不受此限制。
   */
  private async assertMessageAllowed(
    conversationId: bigint,
    senderId: bigint,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deleted: 0 },
      select: { type: true },
    });
    if (!conversation || conversation.type !== 'private') {
      return; // 非私信不受限制
    }

    const peerMember = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: { not: senderId },
        deleted: 0,
      },
      select: { userId: true },
    });
    if (!peerMember) {
      return; // 找不到对方（异常数据），不拦
    }

    const friends = await areFriends(this.prisma, senderId, peerMember.userId);
    if (friends) {
      return; // 好友不受限
    }

    const sentCount = await this.prisma.message.count({
      where: { conversationId, senderId, deleted: 0 },
    });
    if (sentCount >= 1) {
      throw BizException.forbidden(
        '你们还不是好友，每个方向只能发一条消息；加为好友后可自由交流',
      );
    }
  }

  /** 未读汇总：当前用户所有会话的未读数，供前端 30s 轮询 */
  async listUnread(userId: string): Promise<UnreadItem[]> {
    const memberships = await this.prisma.conversationMember.findMany({
      where: {
        userId: BigInt(userId),
        deleted: 0,
        conversation: { deleted: 0 },
      },
      select: {
        conversationId: true,
        lastReadAt: true,
      },
    });

    // 逐会话 count 并行发出（各会话 lastReadAt 不同，无法合并为一次 groupBy）
    const counts = await Promise.all(
      memberships.map((row) =>
        this.prisma.message.count({
          where: {
            conversationId: row.conversationId,
            deleted: 0,
            ...(row.lastReadAt ? { createdAt: { gt: row.lastReadAt } } : {}),
          },
        }),
      ),
    );

    return memberships
      .map((row, i) => ({
        conversationId: toIdString(row.conversationId),
        unreadCount: counts[i],
      }))
      .filter((item) => item.unreadCount > 0);
  }

  /** 标记已读：把当前用户的 lastReadAt 推进到当前时间 */
  async markRead(userId: string, idParam: string): Promise<void> {
    const conversationId = await this.requireMemberConversation(
      userId,
      idParam,
    );
    await this.prisma.conversationMember.updateMany({
      where: {
        conversationId,
        userId: BigInt(userId),
        deleted: 0,
      },
      data: { lastReadAt: new Date() },
    });
  }

  // ---------------------------------------------------------------- 内部

  /** 校验用户是会话成员，返回 conversationId */
  private async requireMemberConversation(
    userId: string,
    idParam: string,
  ): Promise<bigint> {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('会话不存在');
    }
    const member = await this.prisma.conversationMember.findFirst({
      where: {
        conversationId: id,
        userId: BigInt(userId),
        deleted: 0,
        conversation: { deleted: 0 },
      },
      select: { id: true },
    });
    if (!member) {
      throw BizException.notFound('会话不存在');
    }
    return id;
  }

  /** 把会话行转换成 ConversationItem（含最后一条消息与未读数） */
  private async toConversationItem(row: {
    id: bigint;
    type: string;
    title: string | null;
    refType: string | null;
    refId: bigint | null;
    updatedAt: Date;
    members: { lastReadAt: Date | null }[];
  }): Promise<ConversationItem> {
    const lastReadAt = row.members[0]?.lastReadAt ?? null;

    // 最后一条消息与未读数互不依赖，并行查询摊平 N+1 延迟
    const [lastMessage, unreadCount] = await Promise.all([
      this.prisma.message.findFirst({
        where: { conversationId: row.id, deleted: 0 },
        orderBy: { id: 'desc' },
        select: { content: true, msgType: true, createdAt: true },
      }),
      this.prisma.message.count({
        where: {
          conversationId: row.id,
          deleted: 0,
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      }),
    ]);

    return {
      id: toIdString(row.id),
      type: row.type,
      title: row.title ?? '',
      refType: row.refType ?? '',
      refId: row.refId === null ? '' : toIdString(row.refId),
      lastMessage: lastMessage?.content ?? '',
      lastMessageAt: lastMessage ? formatDateTime(lastMessage.createdAt) : '',
      unreadCount: row.type === 'comment' ? 0 : unreadCount,
      updatedAt: formatDateTime(row.updatedAt),
    };
  }
}
