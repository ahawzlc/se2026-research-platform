import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MILESTONE_STATUSES, type MilestoneStatus } from './project-query.dto';

/** 创建里程碑入参 */
export class CreateMilestoneDto {
  @ApiProperty({ description: '所属项目 id' })
  @IsString()
  @IsNotEmpty({ message: 'projectId 不能为空' })
  projectId!: string;

  @ApiProperty({ description: '里程碑名称：1-100 个字符' })
  @IsString()
  @IsNotEmpty({ message: '里程碑名称不能为空' })
  @MaxLength(100, { message: '里程碑名称最长 100 个字符' })
  name!: string;

  @ApiPropertyOptional({ description: '截止日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate 需为 yyyy-MM-dd 格式的日期' })
  dueDate?: string;

  @ApiPropertyOptional({
    description: '里程碑状态',
    enum: MILESTONE_STATUSES,
    default: 'pending',
  })
  @IsOptional()
  @IsIn(MILESTONE_STATUSES, { message: 'status 取值非法' })
  status?: MilestoneStatus;
}

/** 更新里程碑入参；全部字段可选 */
export class UpdateMilestoneDto {
  @ApiPropertyOptional({ description: '里程碑名称' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '里程碑名称不能为空' })
  @MaxLength(100, { message: '里程碑名称最长 100 个字符' })
  name?: string;

  @ApiPropertyOptional({ description: '截止日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'dueDate 需为 yyyy-MM-dd 格式的日期' })
  dueDate?: string;

  @ApiPropertyOptional({ description: '里程碑状态', enum: MILESTONE_STATUSES })
  @IsOptional()
  @IsIn(MILESTONE_STATUSES, { message: 'status 取值非法' })
  status?: MilestoneStatus;
}
