import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from '../community.constants';

/** 帖子的申请列表查询参数（分页约定见 docs/01 第四节：page 从 1 起，size 上限 100） */
export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 需为整数' })
  @Min(1, { message: 'page 最小为 1' })
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数，上限 100', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size 需为整数' })
  @Min(1, { message: 'size 最小为 1' })
  @Max(100, { message: 'size 最大为 100' })
  size?: number = 20;

  @ApiPropertyOptional({
    description: '按申请状态过滤，省略为全部',
    enum: APPLICATION_STATUSES,
  })
  @IsOptional()
  @IsIn([...APPLICATION_STATUSES], { message: 'status 取值非法' })
  status?: ApplicationStatus;
}
