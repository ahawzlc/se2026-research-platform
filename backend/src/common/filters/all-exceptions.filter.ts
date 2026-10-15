import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BizException,
  ErrorCode,
  codeToHttpStatus,
  fail,
  httpStatusToCode,
} from '../result';

/**
 * 全局异常过滤器：把任何异常转成统一返回体。
 *
 * 约定（docs/01-接口规范.md）：
 *   - HTTP 状态码**按语义返回**（400 参数错误、401 未授权、404 不存在、500 异常）；
 *   - 响应体里同时给出业务 `code`，前端以 `code` 为准判断成败。
 *   例：参数校验失败 → HTTP 400 + `{ code: 400, message: "…", data: null }`
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let code: number = ErrorCode.INTERNAL;
    let message = '服务器内部错误';
    let httpStatus: number = codeToHttpStatus(ErrorCode.INTERNAL);

    if (exception instanceof BizException) {
      code = exception.code;
      message = exception.message;
      httpStatus = exception.httpStatus;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = httpStatusToCode(httpStatus);
      message = extractMessage(exception);
    } else {
      // 未预期异常：打完整堆栈，对外只返回通用提示，避免泄漏内部信息
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `未捕获异常 ${request.method} ${request.originalUrl}\n${detail}`,
      );
    }

    response.status(httpStatus).json(fail(code, message));
  }
}

function extractMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const raw = (body as { message?: string | string[] }).message;
    if (Array.isArray(raw)) {
      // ValidationPipe 的校验错误是多条信息，合并展示
      return raw.join('；');
    }
    if (typeof raw === 'string') {
      return raw;
    }
  }
  return exception.message;
}
