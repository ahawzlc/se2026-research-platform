import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记接口无需登录即可访问。
 *
 * 全局默认启用 JwtAuthGuard，因此只有登录、注册、健康检查这类接口
 * 需要显式加上 @Public()。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
