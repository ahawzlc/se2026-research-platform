import type { Prisma } from '@prisma/client';
import {
  NotificationsService,
  type PushNotificationInput,
} from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/result';

/** 单测里的 tx 只是 notification 表的替身，传给 service 时按 Prisma 事务客户端看待 */
const asTx = (tx: unknown): Prisma.TransactionClient =>
  tx as Prisma.TransactionClient;

/** notification 表一行快照 */
function buildNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 11n,
    userId: 1n,
    type: 'team_apply',
    title: '张三 申请加入《互联网+项目》',
    refType: 'community_post',
    refId: 5n,
    isRead: 0,
    createdAt: new Date('2026-11-21T02:00:00Z'),
    updatedAt: new Date('2026-11-21T02:00:00Z'),
    deleted: 0,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    notification: {
      create: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const service = new NotificationsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

async function expectBizError(
  promise: Promise<unknown>,
  code: number,
  message: string,
) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('NotificationsService.push（冻结接口）', () => {
  it('写入默认未读、正常字段，并回填格式化条目', async () => {
    const { service, prisma } = createService();
    prisma.notification.create.mockResolvedValue(buildNotification());

    const item = await service.push({
      toUserId: '1',
      type: 'team_apply',
      title: '张三 申请加入《互联网+项目》',
      refType: 'community_post',
      refId: '5',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 1n,
        type: 'team_apply',
        title: '张三 申请加入《互联网+项目》',
        refType: 'community_post',
        refId: 5n,
      },
    });
    expect(item).toMatchObject({
      id: '11',
      isRead: 0,
      refType: 'community_post',
      refId: '5',
    });
  });

  it('refType 与 refId 缺省时不写入跳转字段', async () => {
    const { service, prisma } = createService();
    prisma.notification.create.mockResolvedValue(
      buildNotification({ refType: null, refId: null }),
    );

    await service.push({
      toUserId: 1n,
      type: 'friend_accepted',
      title: '李四 通过了你的好友申请',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 1n,
        type: 'friend_accepted',
        title: '李四 通过了你的好友申请',
      },
    });
  });

  it('未知类型 / 空标题 / 超长标题 / refType 与 refId 只给一个 → 参数错误', async () => {
    const { service } = createService();

    await expectBizError(
      service.push({
        toUserId: '1',
        type: 'unknown_type' as PushNotificationInput['type'],
        title: '标题',
      }),
      ErrorCode.PARAM_INVALID,
      '未知通知类型：unknown_type',
    );
    await expectBizError(
      service.push({ toUserId: '1', type: 'team_apply', title: '   ' }),
      ErrorCode.PARAM_INVALID,
      '通知标题必填且不超过 200 字',
    );
    await expectBizError(
      service.push({
        toUserId: '1',
        type: 'team_apply',
        title: '超'.repeat(201),
      }),
      ErrorCode.PARAM_INVALID,
      '通知标题必填且不超过 200 字',
    );
    await expectBizError(
      service.push({
        toUserId: '1',
        type: 'team_apply',
        title: '标题',
        refType: 'meeting',
      }),
      ErrorCode.PARAM_INVALID,
      'refType 与 refId 必须同时提供或同时缺省',
    );
  });

  it('toUserId 非法字符串 → 参数错误', async () => {
    const { service } = createService();
    await expectBizError(
      service.push({ toUserId: 'abc', type: 'team_apply', title: '标题' }),
      ErrorCode.PARAM_INVALID,
      'toUserId 需为合法 id',
    );
  });
});

describe('NotificationsService.pushInTransaction（卡 E-2 接缝）', () => {
  it('在调用方事务内写入，校验与写入口径和 push 一致', async () => {
    const { service, prisma } = createService();
    const tx = { notification: { create: jest.fn() } };
    tx.notification.create.mockResolvedValue(buildNotification());

    const item = await service.pushInTransaction(asTx(tx), {
      toUserId: '1',
      type: 'team_apply_approved',
      title: '爱丽丝 通过了你加入《互联网+项目》的申请',
      refType: 'community_post',
      refId: '5',
    });

    // 写入走的是调用方的事务客户端，不走 prisma（否则不在同一事务里）
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 1n,
        type: 'team_apply_approved',
        title: '爱丽丝 通过了你加入《互联网+项目》的申请',
        refType: 'community_post',
        refId: 5n,
      },
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(item).toMatchObject({ id: '11', isRead: 0, refId: '5' });
  });

  it('非法入参在写库前被拦下', async () => {
    const { service } = createService();
    const tx = { notification: { create: jest.fn() } };

    await expectBizError(
      service.pushInTransaction(asTx(tx), {
        toUserId: '1',
        type: 'unknown_type' as PushNotificationInput['type'],
        title: '标题',
      }),
      ErrorCode.PARAM_INVALID,
      '未知通知类型：unknown_type',
    );
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

describe('NotificationsService 列表与未读数', () => {
  it('列表按本人过滤，unreadOnly=true 时带 isRead=0，分页字段回传', async () => {
    const { service, prisma } = createService();
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([buildNotification()]);

    const result = await service.list('1', {
      page: 2,
      size: 10,
      unreadOnly: true,
    });

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 1n, deleted: 0, isRead: 0 },
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 1n, deleted: 0, isRead: 0 },
      orderBy: { id: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(result).toMatchObject({ total: 1, page: 2, size: 10 });
    expect(result.list[0]).toMatchObject({ id: '11', isRead: 0 });
  });

  it('未读数只统计本人 + 未删除 + 未读', async () => {
    const { service, prisma } = createService();
    prisma.notification.count.mockResolvedValue(3);

    await expect(service.unreadCount('1')).resolves.toEqual({ count: 3 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 1n, deleted: 0, isRead: 0 },
    });
  });
});

describe('NotificationsService 已读', () => {
  it('本人未读通知 → 置为已读并返回条目', async () => {
    const { service, prisma } = createService();
    prisma.notification.findFirst.mockResolvedValue(buildNotification());
    prisma.notification.update.mockResolvedValue(
      buildNotification({ isRead: 1 }),
    );

    const item = await service.markRead('11', '1');

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 11n },
      data: { isRead: 1 },
    });
    expect(item.isRead).toBe(1);
  });

  it('重复已读幂等：不再发起 update', async () => {
    const { service, prisma } = createService();
    prisma.notification.findFirst.mockResolvedValue(
      buildNotification({ isRead: 1 }),
    );

    await service.markRead('11', '1');
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('非本人通知 / 不存在 / 非法 id → 一律 404，不泄露存在性', async () => {
    const { service, prisma } = createService();
    prisma.notification.findFirst.mockResolvedValue(
      buildNotification({ userId: 9n }),
    );

    await expectBizError(
      service.markRead('11', '1'),
      ErrorCode.NOT_FOUND,
      '通知不存在',
    );
    prisma.notification.findFirst.mockResolvedValue(null);
    await expectBizError(
      service.markRead('11', '1'),
      ErrorCode.NOT_FOUND,
      '通知不存在',
    );
    await expectBizError(
      service.markRead('abc', '1'),
      ErrorCode.NOT_FOUND,
      '通知不存在',
    );
  });

  it('全部已读：updateMany 限定本人且返回标记条数', async () => {
    const { service, prisma } = createService();
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });

    await expect(service.markAllRead('1')).resolves.toEqual({ updated: 4 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 1n, deleted: 0, isRead: 0 },
      data: { isRead: 1 },
    });
  });
});
