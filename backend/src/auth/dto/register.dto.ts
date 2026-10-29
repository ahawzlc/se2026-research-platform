import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 注册入参（注册成功即登录，直接返回令牌） */
export class RegisterDto {
  @ApiProperty({
    description: '用户名：3-50 位字母、数字或下划线',
    example: 'zhangsan',
  })
  @Matches(/^[a-zA-Z0-9_]{3,50}$/, {
    message: '用户名需为 3-50 位字母、数字或下划线',
  })
  username!: string;

  @ApiProperty({
    description: '密码：8-32 位，须同时包含字母和数字',
    example: 'Test1234',
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '密码需为 8-32 位且同时包含字母和数字',
  })
  password!: string;

  @ApiProperty({ description: '昵称：1-50 个字符', example: '张三' })
  @IsString()
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(50, { message: '昵称最长 50 个字符' })
  nickname!: string;

  @ApiPropertyOptional({
    description: '邮箱（可选）',
    example: 'zhangsan@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(100, { message: '邮箱最长 100 个字符' })
  email?: string;
}
