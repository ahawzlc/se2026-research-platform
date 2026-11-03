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

/** 项目状态取值（见 docs/02 project.status） */
export const PROJECT_STATUSES = [
  'planning',
  'active',
  'finished',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** 里程碑状态取值 */
export const MILESTONE_STATUSES = ['pending', 'done'] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** 项目列表查询参数（分页约定见 docs/01 第四节） */
export class ListProjectsQueryDto {
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

  @ApiPropertyOptional({ description: '按状态筛选', enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn(PROJECT_STATUSES, { message: 'status 取值非法' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: '按项目名称模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'keyword 最长 100 个字符' })
  keyword?: string;
}

/** 里程碑列表查询参数 */
export class ListMilestonesQueryDto {
  @ApiPropertyOptional({ description: '按状态筛选', enum: MILESTONE_STATUSES })
  @IsOptional()
  @IsIn(MILESTONE_STATUSES, { message: 'status 取值非法' })
  status?: MilestoneStatus;
}
