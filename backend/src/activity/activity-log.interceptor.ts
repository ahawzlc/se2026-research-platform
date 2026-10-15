import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ACTIVITY_LOG_KEY, ActivityLogOptions } from './activity-log.decorator';
import { ActivityService } from './activity.service';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

/**
 * 埋点拦截器：方法成功返回后，按 @ActivityLog 的声明写一条 activity_log。
 *
 * 只在成功时写入（异常不记账，避免失败操作也攒参与度）。
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<ActivityLogOptions | undefined>(
      ACTIVITY_LOG_KEY,
      context.getHandler(),
    );
    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      user?: CurrentUserPayload;
      body?: Record<string, unknown>;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();

    return next.handle().pipe(
      tap((response) => {
        const userId = request.user?.userId;
        if (!userId) {
          // 未登录（@Public）接口不埋点
          return;
        }

        const teamId = toIdString(
          pick(
            options.teamIdFrom ?? 'body',
            options.teamIdKey ?? 'teamId',
            request,
          ),
        );
        if (!teamId) {
          // 拿不到 teamId 无法归属课题组，统计以团队为单位，因此放弃本次埋点
          return;
        }

        void this.activity.record({
          userId,
          teamId,
          type: options.type,
          refType: options.refType,
          refId: toIdString(pickRefId(options, request, response)),
          weight: options.weight,
        });
      }),
    );
  }
}

/** 把请求/响应里取到的值安全地转成 id 字符串；非标量一律返回 null */
function toIdString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

type RequestLike = {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

function pick(
  from: 'body' | 'param' | 'query',
  key: string,
  request: RequestLike,
): unknown {
  const source =
    from === 'body'
      ? request.body
      : from === 'param'
        ? request.params
        : request.query;
  return source?.[key];
}

function pickRefId(
  options: ActivityLogOptions,
  request: RequestLike,
  response: unknown,
): unknown {
  const key = options.refIdKey ?? 'id';
  const from = options.refIdFrom ?? 'response';
  if (from === 'response') {
    if (response && typeof response === 'object' && key in response) {
      return (response as Record<string, unknown>)[key];
    }
    return undefined;
  }
  return pick(from, key, request);
}
