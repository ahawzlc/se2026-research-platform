/**
 * 通知中心常量（卡 G-1）。
 *
 * type 取值与 docs/01「通知中心」、docs/02 notification 表注释保持一致；
 * 新增类型必须三处同步（docs/01 → docs/02 → 本文件），并知会调用方所在的线。
 */

/** 通知类型（meeting_upcoming 为线④ F-2 会前提醒占位，Phase 2 启用） */
export const NOTIFICATION_TYPES = [
  'team_apply',
  'team_apply_approved',
  'team_apply_rejected',
  'friend_request',
  'friend_accepted',
  'meeting_upcoming',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 跳转来源对象类型（多态引用列，不建外键，见 docs/02） */
export const NOTIFICATION_REF_TYPES = [
  'community_post',
  'friendship',
  'meeting',
  'conversation',
] as const;

export type NotificationRefType = (typeof NOTIFICATION_REF_TYPES)[number];

/** 通知标题长度上限（与 notification.title VARCHAR(200) 对齐） */
export const NOTIFICATION_TITLE_MAX = 200;
