import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 通过 UID 发起好友申请（线③ 卡 E-3）。
 *
 * 只允许按 UID 申请。
 *
 * 说明：接口的返回里**是**带 `id` 的（内部主键，字符串形式）——
 * 评审意见 C2③ 指出「DTO 注释说不暴露 user.id」与实现不符，
 * 返回 id 本身没有问题（它是内部主键，不是登录名），故这里把注释改成与实现一致。
 * 真正的意图是：**申请入口只认 UID**，不提供「按 id 加好友」的接口，
 * 避免猜到自增 id 就能绕过 UID 发起申请。
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
