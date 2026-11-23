import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PUBLIC_UID_PATTERN } from '../user.constants';

/**
 * 按 UID 查找用户（线③ 卡 E-3）。
 *
 * UID 是对外展示的稳定标识（形如 U0000000123），供好友页"通过 UID 添加好友"用。
 * 大小写不敏感：UID 全为大写数字前缀，查询时统一转大写。
 */
export class FindUserByUidDto {
  @ApiProperty({
    description: '用户 UID，形如 U0000000123',
    example: 'U0000000123',
  })
  @IsString()
  @IsNotEmpty({ message: 'UID 不能为空' })
  @MaxLength(20, { message: 'UID 最长 20 个字符' })
  @Matches(PUBLIC_UID_PATTERN, {
    message: 'UID 格式不正确（应为 U 开头 + 10 位数字）',
  })
  uid!: string;
}
