import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { READ_STATUSES, type ReadStatus } from './literature.dto';

/** 文献列表查询参数（分页约定见 docs/01 第四节） */
export class ListLiteraturesQueryDto {
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

  @ApiPropertyOptional({ description: '按课题组过滤' })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({ description: '按项目过滤' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '按阅读状态过滤', enum: READ_STATUSES })
  @IsOptional()
  @IsIn(READ_STATUSES, { message: 'readStatus 取值非法' })
  readStatus?: ReadStatus;

  @ApiPropertyOptional({ description: '按标签过滤' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '标签最长 50 个字符' })
  tag?: string;

  @ApiPropertyOptional({ description: '按标题模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'keyword 最长 100 个字符' })
  keyword?: string;
}
