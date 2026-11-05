import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** 会议列表查询参数（分页约定见 docs/01 第四节） */
export class ListMeetingsQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 需为整数' })
  @Min(1, { message: 'page 最小为 1' })
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数，上限 100', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size 需为整数' })
  @Min(1, { message: 'size 最小为 1' })
  @Max(100, { message: 'size 最大为 100' })
  size?: number = 10;

  @ApiPropertyOptional({ description: '按项目过滤' })
  @IsOptional()
  @IsString()
  projectId?: string;
}
