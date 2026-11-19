import { RateLimitService } from './rate-limit.service';

describe('RateLimitService（登录/注册限流）', () => {
  it('窗口内放行 N 次、第 N+1 次拦截', () => {
    const service = new RateLimitService();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(service.hit('ip:1.1.1.1', 3, 60_000, t0 + i * 100)).toBe(true);
    }
    expect(service.hit('ip:1.1.1.1', 3, 60_000, t0 + 400)).toBe(false);
  });

  it('窗口滑出后恢复放行（滑动窗口，非固定窗口）', () => {
    const service = new RateLimitService();
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) {
      service.hit('ip:2.2.2.2', 3, 60_000, t0 + i * 1_000);
    }
    // t0+61s：最早一次已滑出 60s 窗口
    expect(service.hit('ip:2.2.2.2', 3, 60_000, t0 + 61_000)).toBe(true);
  });

  it('被拦截的请求不追加时间戳（否则一次拦截即永久锁死）', () => {
    const service = new RateLimitService();
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i++) {
      service.hit('user:u', 5, 60_000, t0);
    }
    // 连续拦截多次，均不写入；60s 后应立即恢复
    for (let i = 0; i < 10; i++) {
      expect(service.hit('user:u', 5, 60_000, t0 + i * 100)).toBe(false);
    }
    expect(service.hit('user:u', 5, 60_000, t0 + 60_001)).toBe(true);
  });

  it('不同键互不影响', () => {
    const service = new RateLimitService();
    const t0 = 4_000_000;
    for (let i = 0; i < 5; i++) {
      service.hit('user:a', 5, 60_000, t0);
    }
    expect(service.hit('user:a', 5, 60_000, t0)).toBe(false);
    expect(service.hit('user:b', 5, 60_000, t0)).toBe(true);
  });
});
