import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 通过 UID 发起好友申请（线③ 卡 E-3）。
 *
 * 只允许按 UID 申请（不暴露 user.id 的可枚举性——user.id 是自增主键，
 * 猜到别人的 id 就能绕过 UID 加好友）。
 *
 * 大小写不敏感：用户手输小写很常见，正则用 `[Uu]` 兼容，
 * 真正的归一化（大写）在 service 层做。
 */
export class CreateFriendRequestDto {
  @ApiProperty({
    description: '对方 UID，形如 U0000000123（大小写均可）',
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
