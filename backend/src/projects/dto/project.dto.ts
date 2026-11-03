import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROJECT_STATUSES, type ProjectStatus } from './project-query.dto';

/** 创建项目入参 */
export class CreateProjectDto {
  @ApiProperty({ description: '项目名称：1-100 个字符' })
  @IsString()
  @IsNotEmpty({ message: '项目名称不能为空' })
  @MaxLength(100, { message: '项目名称最长 100 个字符' })
  name!: string;

  @ApiPropertyOptional({ description: '项目简介（可选）' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '简介最长 500 个字符' })
  description?: string;

  @ApiPropertyOptional({
    description: '所属课题组 id；不传则取当前用户的第一个课题组',
  })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    description: '项目状态',
    enum: PROJECT_STATUSES,
    default: 'planning',
  })
  @IsOptional()
  @IsIn(PROJECT_STATUSES, { message: 'status 取值非法' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: '开始日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'startDate 需为 yyyy-MM-dd 格式的日期' })
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'endDate 需为 yyyy-MM-dd 格式的日期' })
  endDate?: string;
}

/** 更新项目入参；全部字段可选，未传的字段保持不变 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ description: '项目名称' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '项目名称不能为空' })
  @MaxLength(100, { message: '项目名称最长 100 个字符' })
  name?: string;

  @ApiPropertyOptional({ description: '项目简介' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '简介最长 500 个字符' })
  description?: string;

  @ApiPropertyOptional({ description: '项目状态', enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn(PROJECT_STATUSES, { message: 'status 取值非法' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: '开始日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'startDate 需为 yyyy-MM-dd 格式的日期' })
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期 yyyy-MM-dd' })
  @IsOptional()
  @IsDateString({}, { message: 'endDate 需为 yyyy-MM-dd 格式的日期' })
  endDate?: string;
}
