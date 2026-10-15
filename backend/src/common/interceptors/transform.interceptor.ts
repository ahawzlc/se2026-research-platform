import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse, ok } from '../result';

/** 已经带 code/message/data 的返回值不重复包装 */
function isWrapped(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'data' in value
  );
}

/**
 * 统一返回体拦截器：业务代码只需返回数据本身。
 *
 * 例外：文件下载（StreamableFile）与已包装过的返回值保持原样。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile || isWrapped(data)) {
          return data;
        }
        return ok(data);
      }),
    );
  }
}
