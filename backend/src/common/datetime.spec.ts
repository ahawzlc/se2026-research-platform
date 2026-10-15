import { formatDate, formatDateTime, toIdString } from './datetime';

describe('时间格式化（按 docs/01 约定的北京时间）', () => {
  it('UTC 时间转成 yyyy-MM-dd HH:mm:ss（+8 小时）', () => {
    // 2026-10-15T09:53:10Z → 北京时间 17:53:10
    expect(formatDateTime(new Date('2026-10-15T09:53:10.429Z'))).toBe(
      '2026-10-15 17:53:10',
    );
  });

  it('跨日边界正确进位', () => {
    // 北京时间 2026-10-16 00:30:00
    expect(formatDateTime(new Date('2026-10-15T16:30:00.000Z'))).toBe(
      '2026-10-16 00:30:00',
    );
  });

  it('formatDate 只保留年月日，用于 DATE 类型字段', () => {
    expect(formatDate(new Date('2026-10-15T16:30:00.000Z'))).toBe('2026-10-16');
  });

  it('空值与非法值返回空字符串，不抛异常', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
    expect(formatDate(null)).toBe('');
  });

  it('接受字符串与时间戳输入', () => {
    expect(formatDateTime('2026-10-15T09:53:10.000Z')).toBe(
      '2026-10-15 17:53:10',
    );
    expect(formatDateTime(Date.parse('2026-10-15T09:53:10.000Z'))).toBe(
      '2026-10-15 17:53:10',
    );
  });
});

describe('id 统一为字符串', () => {
  it('BigInt / number / string 都能转', () => {
    expect(toIdString(1n)).toBe('1');
    expect(toIdString(2)).toBe('2');
    expect(toIdString('3')).toBe('3');
  });

  it('空值返回空字符串', () => {
    expect(toIdString(null)).toBe('');
    expect(toIdString(undefined)).toBe('');
  });
});
