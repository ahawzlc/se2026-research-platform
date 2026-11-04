import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 阅读状态（docs/02 literature.read_status） */
export const READ_STATUSES = ['unread', 'reading', 'read'] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

/** 创建文献入参 */
export class CreateLiteratureDto {
  @ApiPropertyOptional({
    description: '所属课题组 id；不传则取当前用户的第一个课题组',
  })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    description: '所属项目 id（可空，文献可只挂课题组）',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ description: '文献标题：1-300 个字符' })
  @IsString()
  @IsNotEmpty({ message: '文献标题不能为空' })
  @MaxLength(300, { message: '标题最长 300 个字符' })
  title!: string;

  @ApiPropertyOptional({ description: '外链地址（与附件二选一）' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '外链最长 500 个字符' })
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '附件 file.id（与附件外链二选一）' })
  @IsOptional()
  @IsString()
  fileId?: string;

  @ApiPropertyOptional({
    description: '阅读状态',
    enum: READ_STATUSES,
    default: 'unread',
  })
  @IsOptional()
  @IsIn(READ_STATUSES, { message: 'readStatus 取值非法' })
  readStatus?: ReadStatus;

  @ApiPropertyOptional({ description: '标签列表，最多 10 个' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true, message: '单个标签最长 50 个字符' })
  tags?: string[];
}

/** 更新文献入参；全部可选，未传字段保持不变 */
export class UpdateLiteratureDto {
  @ApiPropertyOptional({ description: '文献标题' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '文献标题不能为空' })
  @MaxLength(300, { message: '标题最长 300 个字符' })
  title?: string;

  @ApiPropertyOptional({ description: '所属项目 id；传空字符串表示清空' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '外链地址；传空字符串表示清空' })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '外链最长 500 个字符' })
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '附件 file.id；传空字符串表示清空' })
  @IsOptional()
  @IsString()
  fileId?: string;

  @ApiPropertyOptional({ description: '标签列表；传空数组表示清空全部标签' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true, message: '单个标签最长 50 个字符' })
  tags?: string[];
}

/** 更新阅读状态入参 */
export class UpdateReadStatusDto {
  @ApiProperty({ description: '目标阅读状态', enum: READ_STATUSES })
  @IsIn(READ_STATUSES, { message: 'readStatus 取值非法' })
  readStatus!: ReadStatus;
}
