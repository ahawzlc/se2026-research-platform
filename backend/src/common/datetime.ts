/**
 * 时间格式化工具（服务端统一出口）。
 *
 * 背景（提前踩坑）：
 *   - 数据库统一存 **UTC**（MySQL 会话时区设为 +00:00），因为 Prisma 读 MySQL 的
 *     DATETIME 时一律按 UTC 解释；若库里存的是 +08:00 的墙钟时间，接口吐出来会差 8 小时。
 *   - 接口对外按 docs/01-接口规范.md 的约定输出 `yyyy-MM-dd HH:mm:ss`（北京时间），
 *     因此业务模块在返回实体前，用本文件的函数格式化时间字段。
 *
 * 为什么不直接用 `new Date().toISOString()`：那会吐出 `2026-10-15T09:53:10.429Z`，
 * 与规范不符，前端还得额外装 dayjs 去转。
 */

/** 北京时间相对 UTC 的偏移（分钟） */
const CN_OFFSET_MINUTES = 8 * 60;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `yyyy-MM-dd HH:mm:ss`（北京时间），入参为空时返回空字符串 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const shifted = new Date(date.getTime() + CN_OFFSET_MINUTES * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = pad(shifted.getUTCMonth() + 1);
  const d = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const mi = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * `yyyy-MM-dd`（北京时间），用于 DATE 类型字段（截止日期、开始/结束日期等）。
 * 例：milestone.dueDate、task.dueDate、project.startDate
 */
export function formatDate(
  value: Date | string | number | null | undefined,
): string {
  const text = formatDateTime(value);
  return text ? text.slice(0, 10) : '';
}

/**
 * 把数据库里的 BigInt/字符串 id 统一成字符串（与 JSON 序列化结果一致）。
 * 便于业务代码在拼接前做类型统一。
 */
export function toIdString(
  value: bigint | number | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : value.toString();
}
