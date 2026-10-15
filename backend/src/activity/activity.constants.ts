/**
 * 行为埋点的类型与权重常量。
 *
 * ⚠️ 口径唯一来源是 docs/03-贡献度口径说明.md，改权重必须先改文档再改这里。
 * 权重集中在此处管理，不散落到业务代码（答辩要求「口径可追溯、权重可校准」）。
 */

export const ActivityType = {
  TASK_CREATE: 'task_create',
  TASK_DONE: 'task_done',
  COMMENT_CREATE: 'comment_create',
  LITERATURE_UPLOAD: 'literature_upload',
  LITERATURE_READ: 'literature_read',
  MEETING_CREATE: 'meeting_create',
  MEETING_ATTEND: 'meeting_attend',
  ACHIEVEMENT_SUBMIT: 'achievement_submit',
  MILESTONE_DONE: 'milestone_done',
} as const;

export type ActivityTypeValue =
  (typeof ActivityType)[keyof typeof ActivityType];

/** 与 docs/03 第三节「维度划分」保持一致的基础权重 */
export const ACTIVITY_DEFAULT_WEIGHT: Record<ActivityTypeValue, number> = {
  [ActivityType.TASK_CREATE]: 3.0,
  [ActivityType.TASK_DONE]: 3.0,
  [ActivityType.ACHIEVEMENT_SUBMIT]: 3.0,
  [ActivityType.MILESTONE_DONE]: 2.5,
  [ActivityType.MEETING_CREATE]: 1.5,
  [ActivityType.MEETING_ATTEND]: 1.5,
  [ActivityType.LITERATURE_UPLOAD]: 1.0,
  [ActivityType.LITERATURE_READ]: 1.0,
  [ActivityType.COMMENT_CREATE]: 0.5,
};

/** 单日上限（docs/03 第六节反刷分设计第 2 条） */
export const ACTIVITY_DAILY_LIMIT: Partial<Record<ActivityTypeValue, number>> =
  {
    [ActivityType.COMMENT_CREATE]: 10,
    [ActivityType.LITERATURE_UPLOAD]: 5,
    [ActivityType.LITERATURE_READ]: 5,
  };
