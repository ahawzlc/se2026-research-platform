import {
  deriveMeetingStatus,
  isMeetingEnded,
  ONGOING_WINDOW_MINUTES,
} from './meeting-status';

/**
 * 会议状态推导（线③ 卡 F-1 抽出为共享纯函数）。
 *
 * 口径：会议表没有结束时间，按「开始时间 + 默认 120 分钟」估算。
 * 边界全部取闭/开区间端点——真实边界是用户最容易投诉的地方
 * （「会议都结束了怎么还说我进行中」），故逐一钉死。
 */
describe('deriveMeetingStatus', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const base = now.getTime();

  it('heldAt 为空 → unscheduled（未排期）', () => {
    expect(deriveMeetingStatus(null, now)).toBe('unscheduled');
    expect(deriveMeetingStatus(undefined, now)).toBe('unscheduled');
  });

  it('开始时间在将来 → upcoming', () => {
    expect(deriveMeetingStatus(new Date(base + 1), now)).toBe('upcoming');
  });

  it('开始时间恰好等于现在 → ongoing（边界含）', () => {
    expect(deriveMeetingStatus(new Date(base), now)).toBe('ongoing');
  });

  it('开始时间刚过 1ms → ongoing', () => {
    expect(deriveMeetingStatus(new Date(base - 1), now)).toBe('ongoing');
  });

  it('距开始 119 分钟 → ongoing', () => {
    expect(deriveMeetingStatus(new Date(base - 119 * 60_000), now)).toBe(
      'ongoing',
    );
  });

  it('距开始恰好 120 分钟 → ended（边界含）', () => {
    expect(
      deriveMeetingStatus(
        new Date(base - ONGOING_WINDOW_MINUTES * 60_000),
        now,
      ),
    ).toBe('ended');
  });

  it('距开始 121 分钟 → ended', () => {
    expect(deriveMeetingStatus(new Date(base - 121 * 60_000), now)).toBe(
      'ended',
    );
  });

  it('开始时间在很久以前 → ended', () => {
    expect(deriveMeetingStatus(new Date('2026-01-01T00:00:00Z'), now)).toBe(
      'ended',
    );
  });
});

describe('isMeetingEnded', () => {
  const now = new Date('2026-11-27T12:00:00Z');

  it('未排期不算结束（讨论区照常可发言）', () => {
    expect(isMeetingEnded(null, now)).toBe(false);
  });

  it('进行中不算结束', () => {
    expect(isMeetingEnded(new Date(now.getTime() - 60_000), now)).toBe(false);
  });

  it('已结束 → true', () => {
    expect(isMeetingEnded(new Date(now.getTime() - 3 * 60 * 60_000), now)).toBe(
      true,
    );
  });
});
