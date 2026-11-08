import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 会议时间格式：yyyy-MM-dd HH:mm:ss（北京时间） */
export const MEETING_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** 创建会议入参 */
export class CreateMeetingDto {
  @ApiProperty({ description: '所属项目 id（会议必须挂在项目下）' })
  @IsString()
  @IsNotEmpty({ message: 'projectId 不能为空' })
  projectId!: string;

  @ApiProperty({ description: '会议主题：1-200 个字符' })
  @IsString()
  @IsNotEmpty({ message: '会议主题不能为空' })
  @MaxLength(200, { message: '会议主题最长 200 个字符' })
  title!: string;

  @ApiPropertyOptional({
    description: '召开时间 yyyy-MM-dd HH:mm:ss（北京时间）',
    example: '2026-11-10 14:30:00',
  })
  @IsOptional()
  @Matches(MEETING_TIME_PATTERN, {
    message: 'heldAt 需为 yyyy-MM-dd HH:mm:ss 格式',
  })
  heldAt?: string;

  @ApiPropertyOptional({ description: '地点或线上会议链接，最长 200 个字符' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '地点最长 200 个字符' })
  location?: string;

  @ApiPropertyOptional({ description: '会议记录正文，最长 20000 个字符' })
  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: '会议记录最长 20000 个字符' })
  content?: string;

  @ApiPropertyOptional({
    description: '参会人 userId 列表（必须是本课题组成员，最多 50 人）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attendeeIds?: string[];
}

/** 更新会议入参；全部可选，未传字段保持不变 */
export class UpdateMeetingDto {
  @ApiPropertyOptional({ description: '会议主题' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '会议主题不能为空' })
  @MaxLength(200, { message: '会议主题最长 200 个字符' })
  title?: string;

  @ApiPropertyOptional({
    description: '召开时间 yyyy-MM-dd HH:mm:ss（北京时间）；传空字符串表示清空',
  })
  @IsOptional()
  @Matches(MEETING_TIME_PATTERN, {
    message: 'heldAt 需为 yyyy-MM-dd HH:mm:ss 格式',
  })
  heldAt?: string;

  @ApiPropertyOptional({
    description: '地点；传空字符串表示清空',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '地点最长 200 个字符' })
  location?: string;

  @ApiPropertyOptional({
    description: '会议记录正文；传空字符串表示清空',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: '会议记录最长 20000 个字符' })
  content?: string;

  @ApiPropertyOptional({
    description: '参会人 userId 列表；传空数组表示清空全部参会人',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attendeeIds?: string[];
}
