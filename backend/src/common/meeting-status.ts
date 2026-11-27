/**
 * 会议状态推导（线③ 卡 F-1 抽出为共享纯函数）。
 *
 * 口径与 meetings.service 一致：**会议表没有结束时间**，
 * 按「开始时间 + 默认 120 分钟」估算四个状态：
 *   - 空 `heldAt` → `unscheduled`（未排期）
 *   - `heldAt > now` → `upcoming`（未开始）
 *   - `heldAt <= now < heldAt + 120min` → `ongoing`（进行中）
 *   - 满 120 分钟 → `ended`（已结束）
 *
 * 为什么抽成共享函数：
 * F-1 的会议讨论区要判断「会议已结束 → 讨论区只读」，
 * 而会议列表/详情页也要显示同一个状态。
 * 两处各写一份必然漂移（改了一处忘了另一处），
 * 故统一放在这里，两边都引。
 */

/** 会议默认时长（分钟）：会议表无结束时间，按此估算「已结束」 */
export const ONGOING_WINDOW_MINUTES = 120;

/** 会议状态取值 */
export type MeetingStatus = 'upcoming' | 'ongoing' | 'ended' | 'unscheduled';

/**
 * 按开始时间推导会议状态。
 *
 * @param heldAt 会议开始时间；null/undefined → `unscheduled`
 * @param now 参考时刻（默认取当前时间；测试可注入固定值）
 */
export function deriveMeetingStatus(
  heldAt: Date | null | undefined,
  now: Date = new Date(),
): MeetingStatus {
  if (!heldAt) {
    return 'unscheduled';
  }
  const startsAt = heldAt.getTime();
  const nowMs = now.getTime();
  if (startsAt > nowMs) {
    return 'upcoming';
  }
  if (nowMs < startsAt + ONGOING_WINDOW_MINUTES * 60_000) {
    return 'ongoing';
  }
  return 'ended';
}

/**
 * 会议是否已结束（讨论区只读判据）。
 *
 * 注意：`unscheduled`（未填开始时间）**不算已结束**——
 * 未排期的会议没有「结束」这一说，讨论区照常可用。
 */
export function isMeetingEnded(
  heldAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return deriveMeetingStatus(heldAt, now) === 'ended';
}
