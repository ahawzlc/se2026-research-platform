import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { APPLICATION_NOTE_MAX } from '../community.constants';
import { Trim } from './transform';

/** 申请加入入参（申请说明可省略） */
export class ApplyPostDto {
  @ApiPropertyOptional({
    description: `申请说明，最长 ${APPLICATION_NOTE_MAX} 个字符`,
    example: '我会前端，做过两个 Vue 项目',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: '申请说明需为字符串' })
  @MaxLength(APPLICATION_NOTE_MAX, {
    message: `申请说明最长 ${APPLICATION_NOTE_MAX} 个字符`,
  })
  note?: string;
}
