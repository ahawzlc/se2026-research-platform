/**
 * 组队广场常量（线②，卡 E-1 / E-2）。
 *
 * 取值与 docs/01「组队广场」、docs/02 第七节社区类表的列注释保持一致；
 * 长度与范围上限取自列定义（VARCHAR / TINYINT UNSIGNED），改列必须先改 docs/02。
 */

/** 帖子状态：recruiting 招募中 / full 已满员 / closed 已停止 */
export const POST_STATUSES = ['recruiting', 'full', 'closed'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** 标签类别：competition 竞赛 / course 课程 */
export const TAG_CATEGORIES = ['competition', 'course'] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

/** community_post.title VARCHAR(50) */
export const POST_TITLE_MAX = 50;
/** 项目情况说明上限（任务卡口径；列为 TEXT，容量远大于此） */
export const POST_CONTENT_MAX = 5000;
/** community_post.recruit_total TINYINT UNSIGNED，业务范围 1-10 */
export const RECRUIT_TOTAL_MIN = 1;
export const RECRUIT_TOTAL_MAX = 10;
/** 每帖必选 1-3 个标签 */
export const POST_TAG_MIN = 1;
export const POST_TAG_MAX = 3;
/** community_tag.name VARCHAR(50) */
export const TAG_NAME_MAX = 50;

/** 申请状态：pending 待处理 / approved 已通过 / rejected 已拒绝（不可逆） */
export const APPLICATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** team_application.note VARCHAR(200) */
export const APPLICATION_NOTE_MAX = 200;
