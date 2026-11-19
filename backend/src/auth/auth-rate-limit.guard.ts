import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BizException } from '../common/result';
import { RateLimitService } from './rate-limit.service';

/** 单 IP 每分钟允许的登录+注册总次数（防单点爆破） */
const IP_LIMIT_PER_MINUTE = 20;

/** 同一用户名每分钟允许的登录尝试次数（防定向撞库） */
const LOGIN_PER_USER_PER_MINUTE = 5;

const WINDOW_MS = 60_000;

/** 守卫只读取的字段（Nest 的 request 类型过宽，收窄后过严格 lint） */
interface LimitedRequest {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
  route?: { path?: string };
  body?: { username?: unknown };
}

/**
 * 登录/注册限流守卫（docs/07「公网暴露前检查单」第 2 项）。
 *
 * 超限抛 400 + 「尝试过于频繁」文案：红线 2 冻结的错误码集合里没有 429，
 * 选择最贴近"客户端稍后重试"语义的 400，并在 docs/01 备注该行为。
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<LimitedRequest>();
    const ip = this.clientIp(request);
    if (!this.rateLimit.hit(`ip:${ip}`, IP_LIMIT_PER_MINUTE, WINDOW_MS)) {
      throw BizException.param('尝试过于频繁，请 1 分钟后再试');
    }

    const isLogin = request.route?.path?.endsWith('/auth/login') ?? false;
    const username = request.body?.username;
    if (isLogin && typeof username === 'string' && username) {
      const key = `user:${username.toLowerCase()}`;
      if (!this.rateLimit.hit(key, LOGIN_PER_USER_PER_MINUTE, WINDOW_MS)) {
        throw BizException.param('该账号尝试过于频繁，请 1 分钟后再试');
      }
    }
    return true;
  }

  /** 部署在 Nginx 后面，优先取 x-forwarded-for 的第一个地址 */
  private clientIp(request: LimitedRequest): string {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }
}
