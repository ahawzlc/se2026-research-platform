import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BIO_MAX_LENGTH, PROFILE_VISIBILITIES } from '../user.constants';

/**
 * 更新个人主页资料（线③ 卡 E-3）。
 *
 * 与卡 A-补1 的 UpdateProfileDto 分工：
 *   - A-补1（auth 模块）：改 nickname / email，历史接口，保留不动；
 *   - 本 DTO（users 模块）：改 nickname / avatar / bio / profileVisibility，
 *     是个人主页的正式设置入口。
 *
 * 字段全部可选，但至少要传一个（服务层校验）。
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({ description: '昵称：1-50 个字符' })
  @IsOptional()
  @IsString()
  // 不能为空串：早期版本只校验长度，传纯空格会落库成 ""（评审意见 D1）
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(50, { message: '昵称最长 50 个字符' })
  nickname?: string;

  @ApiPropertyOptional({
    description:
      '头像地址：只能是本站文件上传接口（/api/v1/files/...）返回的地址；留空表示用昵称首字母生成默认头像',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '头像地址最长 255 个字符' })
  avatar?: string;

  @ApiPropertyOptional({
    description: `个人简介，最多 ${BIO_MAX_LENGTH} 个字符`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BIO_MAX_LENGTH, {
    message: `简介最长 ${BIO_MAX_LENGTH} 个字符`,
  })
  bio?: string;

  @ApiPropertyOptional({
    description:
      '主页可见范围：public 所有人可见 / friends 仅好友可见 / private 仅自己可见',
    enum: PROFILE_VISIBILITIES,
  })
  @IsOptional()
  @IsIn(PROFILE_VISIBILITIES, {
    message: `可见范围必须是 ${PROFILE_VISIBILITIES.join(' / ')} 之一`,
  })
  profileVisibility?: (typeof PROFILE_VISIBILITIES)[number];
}
