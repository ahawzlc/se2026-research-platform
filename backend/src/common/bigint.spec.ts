import { enableBigIntJsonSerialization } from './bigint';

describe('BigInt 的 JSON 序列化', () => {
  it('未打补丁时 JSON.stringify 会抛错（说明这个补丁确有必要）', () => {
    // 用临时对象模拟：直接序列化 BigInt 一定失败
    expect(() => JSON.stringify({ id: 1n })).toThrow();
  });

  it('打完补丁后能序列化为字符串', () => {
    enableBigIntJsonSerialization();
    expect(JSON.stringify({ id: 1n, size: 1024n })).toBe(
      '{"id":"1","size":"1024"}',
    );
  });

  it('重复调用是幂等的', () => {
    enableBigIntJsonSerialization();
    enableBigIntJsonSerialization();
    expect(JSON.stringify(9007199254740993n)).toBe('"9007199254740993"');
  });

  it('超出 Number 精度的值不丢精度', () => {
    enableBigIntJsonSerialization();
    // 2^53 + 1，用 Number 会变成 9007199254740992
    expect(JSON.stringify({ id: 9007199254740993n })).toBe(
      '{"id":"9007199254740993"}',
    );
  });
});
