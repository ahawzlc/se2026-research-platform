import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TITLE_MAX,
  type NotificationType,
} from './notification.constants';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query';

/**
 * push 接口入参（**冻结签名**，线② E-2 / 线③ E-3 / 线④ F-2 依赖，改动需群里打招呼）：
 * 幂等由调用方保证——例如 F-2 会前提醒先按 (userId, type, refId) 查重再推。
 */
export interface PushNotificationInput {
  toUserId: bigint | string;
  type: NotificationType;
  title: string;
  /** 跳转来源对象类型（community_post / friendship / meeting / conversation），与 refId 同进同退 */
  refType?: string;
  refId?: bigint | string;
}

/** 通知条目（列表与铃铛共用） */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  /** 无跳转来源时为空字符串 */
  refType: string;
  refId: string;
  /** 0 未读 / 1 已读（与表内 TINYINT 口径一致） */
  isRead: number;
  createdAt: string;
}

/**
 * 通知中心服务（任务卡 G-1，线①）。
 *
 * 约定：
 *   - 通知是**个人维度**资源（平台第一个无团队归属的模块）：
 *     service 层仅按 userId 过滤，不做 team_member 复核（红线 9 的"归属条件"在此即本人）；
 *   - 写入唯一入口是 push，不开放 HTTP 写接口（docs/01「通知中心」）；
 *   - 消息未读走消息页既有机制，不进铃铛——铃铛只管事件通知；
 *   - 所有查询显式带 deleted: 0（红线 5）。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 服务端写入一条通知（唯一写入口） */
  async push(input: PushNotificationInput): Promise<NotificationItem> {
    const title = (input.title ?? '').trim();
    if (!title || title.length > NOTIFICATION_TITLE_MAX) {
      throw BizException.param(
        `通知标题必填且不超过 ${NOTIFICATION_TITLE_MAX} 字`,
      );
    }
    if (!NOTIFICATION_TYPES.includes(input.type)) {
      throw BizException.param(`未知通知类型：${String(input.type)}`);
    }
    const hasRefType = input.refType !== undefined;
    const hasRefId = input.refId !== undefined;
    if (hasRefType !== hasRefId) {
      throw BizException.param('refType 与 refId 必须同时提供或同时缺省');
    }

    const created = await this.prisma.notification.create({
      data: {
        userId: this.asId(input.toUserId, 'toUserId'),
        type: input.type,
        title,
        ...(hasRefType &&
        input.refType !== undefined &&
        input.refId !== undefined
          ? {
              refType: input.refType,
              refId: this.asId(input.refId, 'refId'),
            }
          : {}),
      },
    });
    return this.toItem(created);
  }

  /** 幂等推送：同一用户、类型、来源只保留一条未删除通知。 */
  async pushOnce(
    input: PushNotificationInput,
  ): Promise<NotificationItem | null> {
    const userId = this.asId(input.toUserId, 'toUserId');
    const refId =
      input.refId === undefined ? undefined : this.asId(input.refId, 'refId');
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId,
        type: input.type,
        refType: input.refType,
        refId,
        deleted: 0,
      },
      orderBy: { id: 'desc' },
    });
    if (existing) return null;
    return this.push({
      ...input,
      toUserId: userId,
      ...(refId === undefined ? {} : { refId }),
    });
  }

  /** 我的通知列表（按 id 倒序，可仅看未读） */
  async list(userIdParam: string, query: ListNotificationsQueryDto) {
    const userId = BigInt(userIdParam);
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const where = {
      userId,
      deleted: 0,
      ...(query.unreadOnly ? { isRead: 0 } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
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

  /** 未读数（顶栏铃铛 30s 轮询） */
  async unreadCount(userIdParam: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId: BigInt(userIdParam), deleted: 0, isRead: 0 },
    });
    return { count };
  }

  /** 单条已读（幂等；非本人通知与不存在同口径 404，不泄露存在性） */
  async markRead(
    idParam: string,
    userIdParam: string,
  ): Promise<NotificationItem> {
    const id = this.parseId(idParam);
    const row = id
      ? await this.prisma.notification.findFirst({
          where: { id, deleted: 0 },
        })
      : null;
    if (!row || row.userId !== BigInt(userIdParam)) {
      throw BizException.notFound('通知不存在');
    }
    if (row.isRead === 0) {
      await this.prisma.notification.update({
        where: { id: row.id },
        data: { isRead: 1 },
      });
    }
    return this.toItem({ ...row, isRead: 1 });
  }

  /** 全部已读，返回本次标记条数 */
  async markAllRead(userIdParam: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: BigInt(userIdParam), deleted: 0, isRead: 0 },
      data: { isRead: 1 },
    });
    return { updated: result.count };
  }

  /** BigInt/字符串 id 宽松转换（push 的调用方传 string | bigint） */
  private asId(value: bigint | string, field: string): bigint {
    if (typeof value === 'bigint') return value;
    if (/^\d+$/.test(value)) return BigInt(value);
    throw BizException.param(`${field} 需为合法 id`);
  }

  /** 路径参数 id 严格解析：非法直接按 404 处理 */
  private parseId(value: string): bigint | null {
    if (!/^\d+$/.test(value)) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  private toItem(row: Notification): NotificationItem {
    return {
      id: toIdString(row.id),
      type: row.type,
      title: row.title,
      refType: row.refType ?? '',
      refId: toIdString(row.refId),
      isRead: row.isRead,
      createdAt: formatDateTime(row.createdAt),
    };
  }
}
