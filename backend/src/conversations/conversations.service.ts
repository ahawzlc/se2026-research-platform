import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';

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

/**
 * 会话服务（统一会话模型的公共实现）。
 *
 * 背景（docs/02 第四节）：上下文评论、项目讨论区、成员私信**共用同一套结构**，
 * 仅以 type 区分。B 组的任务评论（type=comment，锚定 task）与
 * C 组的成果/会议评论复用这里的锚定会话逻辑，故放在公共模块而非某个业务模块内。
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 取得（或创建）锚定在业务对象上的会话。
   *
   * @param type   会话类型，锚定评论固定为 'comment'
   * @param refType 业务对象类型，如 'task' / 'achievement' / 'meeting'
   * @param refId  业务对象 id
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

  /** 向会话发送一条消息 */
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
}
