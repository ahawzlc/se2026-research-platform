/**
 * 统一返回体与业务错误码。
 *
 * 约定（见 docs/01-接口规范.md）：
 *   { code: number, message: string, data: T | null }
 *   code === 0 表示成功；非 0 为业务错误码。
 *
 * 业务代码不要直接 return 裸对象以外的信封——返回业务数据即可，
 * 由 TransformInterceptor 统一包装；抛错请用 BizException。
 */

/** 全局路由前缀 */
export const API_PREFIX = 'api/v1';

/** 业务错误码：取值与 docs/01-接口规范.md 的表保持一致 */
export const ErrorCode = {
  OK: 0,
  /** 400 参数校验失败 */
  PARAM_INVALID: 400,
  /** 401 未登录或令牌无效/过期 */
  UNAUTHORIZED: 401,
  /** 403 已登录但无权限 */
  FORBIDDEN: 403,
  /** 404 资源不存在 */
  NOT_FOUND: 404,
  /** 409 状态冲突（邀请码重复、重复入组等） */
  CONFLICT: 409,
  /** 500 服务端异常 */
  INTERNAL: 500,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP 状态码 → 业务错误码（规范只定义了下表这些，其余按大类归并） */
export function httpStatusToCode(status: number): number {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
      return status;
    default:
      return status >= 500 ? ErrorCode.INTERNAL : ErrorCode.PARAM_INVALID;
  }
}

/** 业务错误码 → HTTP 状态码；规范要求 HTTP 语义化返回 */
export function codeToHttpStatus(code: number): number {
  return code >= 400 && code <= 599 ? code : 200;
}

/** 业务异常：service 层可直接抛出，由全局异常过滤器转成统一返回体 */
export class BizException extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number = codeToHttpStatus(code),
  ) {
    super(message);
    this.name = 'BizException';
  }

  static param(message = '参数不合法') {
    return new BizException(ErrorCode.PARAM_INVALID, message);
  }

  static unauthorized(message = '未登录或登录已过期') {
    return new BizException(ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = '没有操作权限') {
    return new BizException(ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = '资源不存在') {
    return new BizException(ErrorCode.NOT_FOUND, message);
  }

  static conflict(message = '数据已存在') {
    return new BizException(ErrorCode.CONFLICT, message);
  }
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: ErrorCode.OK, message, data };
}

export function fail(code: number, message: string): ApiResponse<null> {
  return { code, message, data: null };
}
