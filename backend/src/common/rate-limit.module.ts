import { Global, Module } from '@nestjs/common';
import { RateLimitService } from '../auth/rate-limit.service';

/**
 * 限流能力模块（线③ 卡 E-3 评审意见 D3）。
 *
 * 把 auth 模块里的 `RateLimitService` 提升为全局 provider，
 * 好让「好友申请」等业务模块也能用同一套滑动窗口实现。
 *
 * 为什么不用 @nestjs/throttler：后端依赖版本钉死（backend/README 第十节），
 * 自研滑窗足够 2C4G 单实例场景，也避免引入跨实例部署下的「假共享」误导。
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
