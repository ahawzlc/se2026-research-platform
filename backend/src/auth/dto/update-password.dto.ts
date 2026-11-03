import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 修改密码入参（卡 A-补2）：先验旧密码，再收新令牌 */
export class UpdatePasswordDto {
  @ApiProperty({
    description: '旧密码（历史弱密码也放行，只要求非空）',
    example: 'Test1234',
  })
  @IsString()
  @IsNotEmpty({ message: '旧密码不能为空' })
  oldPassword!: string;

  @ApiProperty({
    description: '新密码：8-32 位，须同时包含字母和数字',
    example: 'NewPass1234',
  })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '密码需为 8-32 位且同时包含字母和数字',
  })
  newPassword!: string;
}
