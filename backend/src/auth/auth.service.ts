import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** JWT 载荷：sub 为用户主键（字符串形式，避免超出 Number 精度） */
export interface JwtPayload {
  sub: string;
  username: string;
  /** 课题组角色快照，仅用于粗粒度校验，最终权限以 team_member 表为准 */
  roles?: string[];
}

export interface SignTokenInput {
  userId: bigint | number | string;
  username: string;
  roles?: string[];
}

/**
 * 令牌服务：只负责签发与校验。
 *
 * 注册、登录、密码校验、邀请码入组等**业务逻辑属于 A 组**，不在本次底座范围内。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** 签发访问令牌 */
  async sign(input: SignTokenInput): Promise<string> {
    const payload: JwtPayload = {
      sub: String(input.userId),
      username: input.username,
      roles: input.roles ?? [],
    };
    return this.jwt.signAsync(payload);
  }

  /** 校验令牌并返回载荷；失败会抛异常 */
  async verify(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token);
  }

  /** 令牌有效期（秒），用于前端提示 */
  get expiresInSeconds(): number {
    return Number(this.config.get<string>('JWT_EXPIRES_IN_SECONDS', '604800'));
  }
}
