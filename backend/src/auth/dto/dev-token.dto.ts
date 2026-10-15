import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 仅用于本地联调的开发令牌参数（生产禁用） */
export class DevTokenDto {
  @ApiProperty({ description: '用户主键', example: '1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  userId!: string;

  @ApiPropertyOptional({ description: '用户名', example: 'demo' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;
}
