import { analyze, ActivityRow, DIMENSIONS } from './participation';
const members = [
  { userId: '1', nickname: '甲' },
  { userId: '2', nickname: '乙' },
  { userId: '3', nickname: '丙' },
];
function row(
  id: number,
  type = 'task_create',
  refType = 'task',
  userId = 1,
  time = '2026-11-02T00:00:00Z',
): ActivityRow {
  return {
    id: BigInt(id),
    userId: BigInt(userId),
    type,
    refType,
    refId: BigInt(id),
    weight: '999',
    createdAt: new Date(time),
  };
}
const run = (
  rows: ActivityRow[],
  done = new Set<string>(),
  comments = new Set<string>(),
) => analyze(rows, members, done, comments);

describe('参与度口径', () => {
  it('空样本不给成员 0 分', () => {
    expect(run([])).toMatchObject({
      hasData: false,
      members: [],
      weekly: [],
      sampleSize: 0,
      insufficientSample: true,
    });
  });
  it('六维归一化、零最大值、无行为成员与手算值一致；不采用历史任意权重', () => {
    const result = run(
      [
        row(1),
        row(2, 'task_create', 'task', 2),
        row(3, 'task_done'),
        row(4, 'achievement_submit', 'achievement'),
      ],
      new Set(['3']),
    );
    expect(result.members[0].dimensions[0]).toEqual({
      key: 'task',
      raw: 6,
      normalized: 1,
    });
    expect(result.members[1].dimensions[0].normalized).toBe(0.5);
    expect(result.members[0].index).toBeCloseTo(6 / 11.5);
    expect(result.members[1].index).toBeCloseTo(1.5 / 11.5);
    expect(result.members[2]).toMatchObject({ hasData: false, index: null });
    expect(result.weekly).toEqual([
      { weekStart: '2026-11-02', count: 4, weight: 12 },
    ]);
  });
  it('九类行为都映射到对应维度', () => {
    const rows = DIMENSIONS.flatMap((d) =>
      d.types.map((type) => row(1, type, d.ref)),
    );
    const result = run(rows, new Set(['1']), new Set(['1/1']));
    expect(result.sampleSize).toBe(9);
    expect(result.dimensions.every((d) => d.max > 0)).toBe(true);
    expect(result.members[0].index).toBe(1);
  });
  it('同对象同人去重，不吞掉另一个成员的行为', () => {
    const result = run([
      row(1),
      { ...row(2), refId: 1n },
      { ...row(3), userId: 2n, refId: 1n },
    ]);
    expect(result.sampleSize).toBe(2);
    expect(result.details[1].reason).toBe('duplicate');
  });
  it('回退任务不计入，再次完成恢复首次事件且不重复', () => {
    const rows = [row(1, 'task_done'), { ...row(2, 'task_done'), refId: 1n }];
    expect(run(rows).sampleSize).toBe(0);
    expect(run(rows, new Set(['1'])).sampleSize).toBe(1);
  });
  it('评论同日上限 10，跨北京时间午夜重置；周日/周一边界正确', () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      row(i + 1, 'comment_create', 'message', 1, '2026-11-01T15:59:59Z'),
    );
    rows.push(row(12, 'comment_create', 'message', 1, '2026-11-01T16:00:00Z'));
    const result = run(
      rows,
      new Set(),
      new Set(rows.map((r) => `${r.refId}/1`)),
    );
    expect(result.sampleSize).toBe(11);
    expect(result.details[10].reason).toBe('daily_limit');
    expect(result.weekly.map((w) => w.weekStart)).toEqual([
      '2026-10-26',
      '2026-11-02',
    ]);
  });
  it.each(['literature_read', 'literature_upload'])(
    '%s 独立每日上限 5',
    (type) => {
      const result = run(
        Array.from({ length: 6 }, (_, i) => row(i + 1, type, 'literature')),
      );
      expect(result.sampleSize).toBe(5);
      expect(result.details[5].countedWeight).toBe(0);
    },
  );
  it('拒绝未知行为、无关联、错误关联与无效评论（含私信）', () => {
    const result = run([
      row(1, 'login'),
      { ...row(2), refId: null },
      row(3, 'task_create', 'message'),
      row(4, 'comment_create', 'message'),
    ]);
    expect(result.sampleSize).toBe(0);
    expect(result.details.map((d) => d.reason)).toEqual([
      'unknown_type',
      'invalid_ref',
      'invalid_ref',
      'invalid_comment',
    ]);
  });
  it('20 个有效样本解除经验性不足提示', () => {
    expect(
      run(Array.from({ length: 20 }, (_, i) => row(i + 1))).insufficientSample,
    ).toBe(false);
  });
});
