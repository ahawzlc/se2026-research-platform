import { Transform } from 'class-transformer';

/**
 * 去掉字符串首尾空白；非字符串原样返回，交给后续校验器报错。
 *
 * 供 DTO 的文本字段使用，避免「全是空格的标题」绕过 @IsNotEmpty。
 * 回调参数显式标注为 unknown：不标注时 value 是隐式 any，lint 会报 no-unsafe-return。
 */
export const Trim = () =>
  Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  );
