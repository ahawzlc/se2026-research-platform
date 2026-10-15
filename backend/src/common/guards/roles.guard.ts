import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

/**
 * 角色守卫骨架：校验令牌载荷里的 roles 是否命中 @Roles(...)。
 *
 * ⚠️ 本项目角色是「课题组内」的（owner / admin / member），
 * 令牌里的角色只能反映签发时的状态，**不能作为最终权限依据**。
 * 任何涉及具体课题组数据的接口都必须在 service 层查 team_member 复核。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      user?: CurrentUserPayload & { roles?: string[] };
    }>();
    const roles = request.user?.roles ?? [];
    return required.some((role) => roles.includes(role));
  }
}
