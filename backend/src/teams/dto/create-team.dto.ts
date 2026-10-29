import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 创建课题组入参 */
export class CreateTeamDto {
  @ApiProperty({
    description: '课题组名称：1-100 个字符',
    example: '智能感知课题组',
  })
  @IsString()
  @IsNotEmpty({ message: '课题组名称不能为空' })
  @MaxLength(100, { message: '课题组名称最长 100 个字符' })
  name!: string;

  @ApiPropertyOptional({ description: '课题组简介（可选）' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '简介最长 500 个字符' })
  description?: string;
}
