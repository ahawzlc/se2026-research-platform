import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 当前登录用户的令牌载荷 */
export interface CurrentUserPayload {
  /** 用户主键（字符串形式的 id） */
  userId: string;
  username: string;
}

/**
 * 从请求中取出当前登录用户。
 *
 * 用法：`findMe(@CurrentUser() user: CurrentUserPayload)`
 * 也可只取某个字段：`@CurrentUser('userId') userId: string`
 */
export const CurrentUser = createParamDecorator(
  (field: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;
    if (!user) {
      return undefined;
    }
    return field ? user[field] : user;
  },
);
