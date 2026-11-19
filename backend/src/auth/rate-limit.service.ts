import { Injectable } from '@nestjs/common';

/**
 * 登录/注册接口的内存滑动窗口限流（公网暴露前的最低防线，见 docs/07 检查单）。
 *
 * 为什么不用 @nestjs/throttler：后端依赖版本钉死（backend/README 第十节），
 * 自研 ~60 行滑窗足够 2C4G 单实例场景，也避免引入跨实例部署下的"假共享"误导。
 *
 * 错误码约定：超限抛 400（红线 2 的错误码集合冻结，无 429），
 * 文案明确提示等待，见 AuthRateLimitGuard。
 */
@Injectable()
export class RateLimitService {
  /** key -> 窗口内的时间戳（毫秒） */
  private readonly hits = new Map<string, number[]>();

  /** 防御性上限：超出后先做一次全量过期清扫，仍超则丢弃新 key（内存兜底） */
  private static readonly MAX_KEYS = 10_000;

  /**
   * 记录一次命中并判断是否放行。
   * @param key 维度键，如 `ip:1.2.3.4`、`user:zhangsan`
   * @param limit 窗口内允许的最大次数
   * @param windowMs 窗口长度（毫秒）
   * @param now 可注入的当前时间，测试用
   */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const timestamps = (this.hits.get(key) ?? []).filter(
      (ts) => now - ts < windowMs,
    );
    if (timestamps.length >= limit) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    if (this.hits.size > RateLimitService.MAX_KEYS) {
      this.sweep(now, windowMs);
    }
    return true;
  }

  /** 清扫所有窗口已空的键；调用方传当前时间与最长窗口 */
  private sweep(now: number, longestWindowMs: number): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((ts) => now - ts >= longestWindowMs)) {
        this.hits.delete(key);
      }
    }
  }
}
