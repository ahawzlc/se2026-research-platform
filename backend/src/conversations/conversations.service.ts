import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import {
  listUserTeamIds,
  parseId,
  requireTeamMembership,
} from '../common/team-access';
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
 *   - C-5 补充 group / private 会话、未读汇总、标记已读。
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

  /** 创建/获取私信会话：双方必须在同一个课题组 */
  async ensurePrivateConversation(
    userId: string,
    dto: CreatePrivateConversationDto,
  ): Promise<ConversationItem> {
    const peerId = parseId(dto.peerUserId);
    if (peerId === null || peerId === BigInt(userId)) {
      throw BizException.param('peerUserId 非法');
    }

    // 双方必须在同一个课题组
    const myTeams = await listUserTeamIds(this.prisma, userId);
    if (myTeams.length === 0) {
      throw BizException.forbidden('请先加入课题组');
    }
    const peerMembership = await this.prisma.teamMember.findFirst({
      where: {
        userId: peerId,
        teamId: { in: myTeams },
        deleted: 0,
      },
      select: { id: true },
    });
    if (!peerMembership) {
      throw BizException.forbidden('对方不在你的课题组中');
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
    return this.toConversationItem(row);
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
        where: { conversationId, userId: senderId },
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

    const items: UnreadItem[] = [];
    for (const row of memberships) {
      const count = await this.prisma.message.count({
        where: {
          conversationId: row.conversationId,
          deleted: 0,
          ...(row.lastReadAt ? { createdAt: { gt: row.lastReadAt } } : {}),
        },
      });
      if (count > 0) {
        items.push({
          conversationId: toIdString(row.conversationId),
          unreadCount: count,
        });
      }
    }
    return items;
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

    const lastMessage = await this.prisma.message.findFirst({
      where: { conversationId: row.id, deleted: 0 },
      orderBy: { id: 'desc' },
      select: { content: true, msgType: true, createdAt: true },
    });

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId: row.id,
        deleted: 0,
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });

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
