import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** 修改个人资料入参（卡 A-补1）：nickname / email 均可选，至少传一个（service 层校验） */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: '新昵称：1-50 个字符',
    example: '张三丰',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(50, { message: '昵称最长 50 个字符' })
  nickname?: string;

  @ApiPropertyOptional({ description: '新邮箱', example: 'zsf@example.com' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(100, { message: '邮箱最长 100 个字符' })
  email?: string;
}
