import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 按 UID 查找用户（线③ 卡 E-3）。
 *
 * UID 是对外展示的稳定标识（形如 U0000000123），供好友页"通过 UID 添加好友"用。
 * 大小写不敏感：UID 的前缀统一大写，但**入参允许小写**——
 * 用户手输小写或从小票/聊天记录里复制都常见，拦在前端 DTO 会直接 400，太生硬。
 * 校验正则用 `[Uu]` 兼容大小写，真正的归一化（大写）在 service 层做。
 */
export class FindUserByUidDto {
  @ApiProperty({
    description: '用户 UID，形如 U0000000123（大小写均可）',
    example: 'U0000000123',
  })
  @IsString()
  @IsNotEmpty({ message: 'UID 不能为空' })
  @MaxLength(20, { message: 'UID 最长 20 个字符' })
  @Matches(/^[Uu]\d{10}$/, {
    message: 'UID 格式不正确（应为 U 开头 + 10 位数字）',
  })
  uid!: string;
}
