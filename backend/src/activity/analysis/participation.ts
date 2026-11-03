import {
  ACTIVITY_DAILY_LIMIT,
  ACTIVITY_DEFAULT_WEIGHT,
  ActivityTypeValue,
} from '../activity.constants';
import { formatDateTime } from '../../common/datetime';

export const MODEL_VERSION = 'participation-v1-snapshot';
export const SAMPLE_THRESHOLD = 20;
export const LOG_LIMIT = 50000;
export const DISCLAIMER =
  '本图表反映成员在平台内的协作行为分布，仅作团队过程参考，不构成科研贡献评价。';
export const DIMENSIONS = [
  {
    key: 'task',
    label: '任务推进',
    types: ['task_create', 'task_done'],
    ref: 'task',
  },
  {
    key: 'achievement',
    label: '成果沉淀',
    types: ['achievement_submit'],
    ref: 'achievement',
  },
  {
    key: 'milestone',
    label: '里程碑达成',
    types: ['milestone_done'],
    ref: 'milestone',
  },
  {
    key: 'meeting',
    label: '会议参与',
    types: ['meeting_create', 'meeting_attend'],
    ref: 'meeting',
  },
  {
    key: 'literature',
    label: '文献工作',
    types: ['literature_upload', 'literature_read'],
    ref: 'literature',
  },
  {
    key: 'discussion',
    label: '讨论互动',
    types: ['comment_create'],
    ref: 'message',
  },
];
export interface ActivityRow {
  id: bigint;
  userId: bigint;
  type: string;
  refType: string | null;
  refId: bigint | null;
  weight: { toString(): string };
  createdAt: Date;
}
export interface Member {
  userId: string;
  nickname: string;
}

/** 输入须为同一团队、当前有效成员的流水，按发生时间/id 稳定排序。 */
export function analyze(
  rows: ActivityRow[],
  members: Member[],
  doneTasks: Set<string>,
  comments: Set<string>,
) {
  const seen = new Set<string>();
  const daily = new Map<string, number>();
  const details = rows.map((row) => {
    const userId = String(row.userId);
    const dimension = DIMENSIONS.find((d) => d.types.includes(row.type));
    let reason = 'counted';
    const key = JSON.stringify([
      userId,
      row.type,
      row.refType,
      String(row.refId),
    ]);
    const dayKey = `${userId}/${row.type}/${formatDateTime(row.createdAt).slice(0, 10)}`;
    if (!dimension) reason = 'unknown_type';
    else if (
      row.refId === null ||
      row.refId <= 0n ||
      row.refType !== dimension.ref
    )
      reason = 'invalid_ref';
    else if (seen.has(key)) reason = 'duplicate';
    else {
      seen.add(key);
      if (row.type === 'task_done' && !doneTasks.has(String(row.refId)))
        reason = 'inactive_task';
      else if (
        row.type === 'comment_create' &&
        !comments.has(`${row.refId}/${userId}`)
      )
        reason = 'invalid_comment';
      else {
        const count = daily.get(dayKey) ?? 0;
        const limit = ACTIVITY_DAILY_LIMIT[row.type as ActivityTypeValue];
        if (limit !== undefined && count >= limit) reason = 'daily_limit';
        else daily.set(dayKey, count + 1);
      }
    }
    return {
      id: String(row.id),
      userId,
      type: row.type,
      refType: row.refType,
      refId: row.refId === null ? null : String(row.refId),
      createdAt: formatDateTime(row.createdAt),
      dimension: dimension?.key ?? null,
      originalWeight: row.weight.toString(),
      counted: reason === 'counted',
      reason,
      countedWeight:
        reason === 'counted'
          ? ACTIVITY_DEFAULT_WEIGHT[row.type as ActivityTypeValue]
          : 0,
    };
  });
  const counted = details.filter((d) => d.counted);
  const raw = new Map<string, number>();
  const active = new Set<string>();
  const weeks = new Map<
    string,
    { weekStart: string; count: number; weight: number }
  >();
  for (const detail of counted) {
    const key = `${detail.userId}/${detail.dimension}`;
    raw.set(key, (raw.get(key) ?? 0) + detail.countedWeight);
    active.add(detail.userId);
    // 这里的日期已是北京时间墙钟；UTC 运算仅用于求同一日历的周一。
    const date = new Date(`${detail.createdAt.slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekStart = date.toISOString().slice(0, 10);
    const week = weeks.get(weekStart) ?? { weekStart, count: 0, weight: 0 };
    week.count++;
    week.weight += detail.countedWeight;
    weeks.set(weekStart, week);
  }
  const dimensions = DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    weight: ACTIVITY_DEFAULT_WEIGHT[d.types[0] as ActivityTypeValue],
    max: members.reduce(
      (max, m) => Math.max(max, raw.get(`${m.userId}/${d.key}`) ?? 0),
      0,
    ),
  }));
  const denominator = dimensions.reduce((sum, d) => sum + d.weight, 0);
  return {
    modelVersion: MODEL_VERSION,
    disclaimer: DISCLAIMER,
    hasData: counted.length > 0,
    sampleSize: counted.length,
    sampleThreshold: SAMPLE_THRESHOLD,
    insufficientSample: counted.length < SAMPLE_THRESHOLD,
    dimensions,
    members:
      counted.length === 0
        ? []
        : members.map((member) => {
            const values = dimensions.map((d) => {
              const value = raw.get(`${member.userId}/${d.key}`) ?? 0;
              return {
                key: d.key,
                raw: value,
                normalized: d.max === 0 ? 0 : value / d.max,
              };
            });
            return {
              ...member,
              hasData: active.has(member.userId),
              index: active.has(member.userId)
                ? values.reduce(
                    (sum, v, i) => sum + v.normalized * dimensions[i].weight,
                    0,
                  ) / denominator
                : null,
              dimensions: values,
            };
          }),
    weekly: [...weeks.values()],
    details,
  };
}
