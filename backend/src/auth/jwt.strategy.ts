import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from './auth.service';

/**
 * JWT 校验策略：解析 Authorization: Bearer <token>。
 *
 * 目前只校验签名与有效期，不查库（无状态）。
 * TODO（A 组）：若需要「用户被删除/停用后令牌立即失效」，
 * 在 validate 里查一次 user 表并判断 deleted。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      Logger.warn(
        '未配置 JWT_SECRET，正在使用开发默认值，生产环境必须配置',
        JwtStrategy.name,
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret ?? 'dev-only-insecure-secret',
    });
  }

  validate(payload: JwtPayload): CurrentUserPayload & { roles: string[] } {
    return {
      userId: payload.sub,
      username: payload.username,
      roles: payload.roles ?? [],
    };
  }
}
