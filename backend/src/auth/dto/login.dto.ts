import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 登录入参 */
export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'zhangsan' })
  @IsString()
  @IsNotEmpty({ message: '请输入用户名' })
  @MaxLength(50, { message: '用户名最长 50 个字符' })
  username!: string;

  @ApiProperty({ description: '密码', example: 'Test1234' })
  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  @MaxLength(32, { message: '密码最长 32 个字符' })
  password!: string;
}
