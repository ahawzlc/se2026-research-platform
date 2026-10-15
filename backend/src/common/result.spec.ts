import {
  BizException,
  ErrorCode,
  codeToHttpStatus,
  fail,
  httpStatusToCode,
  ok,
} from './result';

/**
 * 公共层单测示例：既验证统一返回体，也给组员一个「测试怎么写」的模板。
 * 业务模块请按同样方式补 spec.ts（`npm test` 会跑 src 下所有 *.spec.ts）。
 */
describe('统一返回体', () => {
  it('ok() 包装为 code=0 的成功返回体', () => {
    expect(ok({ id: 1 })).toEqual({ code: 0, message: 'ok', data: { id: 1 } });
  });

  it('fail() 的 data 恒为 null', () => {
    expect(fail(ErrorCode.PARAM_INVALID, '参数错了')).toEqual({
      code: 400,
      message: '参数错了',
      data: null,
    });
  });

  it('BizException 工厂方法带出对应错误码', () => {
    expect(BizException.unauthorized().code).toBe(ErrorCode.UNAUTHORIZED);
    expect(BizException.forbidden().code).toBe(ErrorCode.FORBIDDEN);
    expect(BizException.notFound().code).toBe(ErrorCode.NOT_FOUND);
    expect(BizException.conflict().code).toBe(ErrorCode.CONFLICT);
  });
});

describe('HTTP 状态码与业务错误码的互转', () => {
  it('规范定义的错误码一一对应', () => {
    expect(httpStatusToCode(400)).toBe(ErrorCode.PARAM_INVALID);
    expect(httpStatusToCode(401)).toBe(ErrorCode.UNAUTHORIZED);
    expect(httpStatusToCode(403)).toBe(ErrorCode.FORBIDDEN);
    expect(httpStatusToCode(404)).toBe(ErrorCode.NOT_FOUND);
    expect(httpStatusToCode(409)).toBe(ErrorCode.CONFLICT);
  });

  it('未在规范中定义的 4xx 归为参数错误，5xx 归为服务端异常', () => {
    expect(httpStatusToCode(422)).toBe(ErrorCode.PARAM_INVALID);
    expect(httpStatusToCode(500)).toBe(ErrorCode.INTERNAL);
    expect(httpStatusToCode(502)).toBe(ErrorCode.INTERNAL);
  });

  it('业务码转 HTTP 状态码：4xx/5xx 原样返回，其余为 200', () => {
    expect(codeToHttpStatus(ErrorCode.NOT_FOUND)).toBe(404);
    expect(codeToHttpStatus(ErrorCode.INTERNAL)).toBe(500);
    expect(codeToHttpStatus(1001)).toBe(200);
  });
});
