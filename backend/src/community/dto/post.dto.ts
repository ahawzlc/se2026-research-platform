import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POST_CONTENT_MAX,
  POST_TAG_MAX,
  POST_TAG_MIN,
  POST_TITLE_MAX,
  RECRUIT_TOTAL_MAX,
  RECRUIT_TOTAL_MIN,
} from '../community.constants';

/** 标签 id 形态：纯数字、不超过 19 位（恒在 BIGINT 范围内，是否存在于字典由 service 判断） */
const TAG_ID_PATTERN = /^\d{1,19}$/;

/** 去掉首尾空白；非字符串原样返回，交给后续校验器报错 */
function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** 发布招募帖入参（校验口径见 docs/01「组队广场」） */
export class CreatePostDto {
  @ApiProperty({
    description: '招募标题：1-50 个字符',
    example: '互联网+项目招前端',
  })
  @Transform(({ value }) => trim(value))
  @IsString({ message: '标题需为字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(POST_TITLE_MAX, { message: `标题最长 ${POST_TITLE_MAX} 个字符` })
  title!: string;

  @ApiPropertyOptional({
    description: '项目情况说明（纯文本），最长 5000 个字符',
  })
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString({ message: '项目情况说明需为字符串' })
  @MaxLength(POST_CONTENT_MAX, {
    message: `项目情况说明最长 ${POST_CONTENT_MAX} 个字符`,
  })
  content?: string;

  @ApiProperty({
    description: `标签 id（取自 /community/tags）：${POST_TAG_MIN}-${POST_TAG_MAX} 个，不可重复`,
    type: [String],
    example: ['1', '6'],
  })
  @IsArray({ message: 'tagIds 需为数组' })
  @ArrayMinSize(POST_TAG_MIN, { message: `至少选择 ${POST_TAG_MIN} 个标签` })
  @ArrayMaxSize(POST_TAG_MAX, { message: `最多选择 ${POST_TAG_MAX} 个标签` })
  @ArrayUnique({ message: '标签不能重复' })
  @IsString({ each: true, message: '标签 id 需为字符串' })
  @Matches(TAG_ID_PATTERN, { each: true, message: '标签 id 需为合法 id' })
  tagIds!: string[];

  @ApiPropertyOptional({
    description: `招募人数：${RECRUIT_TOTAL_MIN}-${RECRUIT_TOTAL_MAX}，默认 ${RECRUIT_TOTAL_MIN}`,
    default: RECRUIT_TOTAL_MIN,
  })
  @IsOptional()
  @IsInt({ message: '招募人数需为整数' })
  @Min(RECRUIT_TOTAL_MIN, { message: `招募人数最少为 ${RECRUIT_TOTAL_MIN}` })
  @Max(RECRUIT_TOTAL_MAX, { message: `招募人数最多为 ${RECRUIT_TOTAL_MAX}` })
  recruitTotal?: number;
}

/** 编辑帖子入参；全部可选，未传字段保持不变，至少传一个（service 层校验） */
export class UpdatePostDto {
  @ApiPropertyOptional({ description: '招募标题：1-50 个字符' })
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString({ message: '标题需为字符串' })
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(POST_TITLE_MAX, { message: `标题最长 ${POST_TITLE_MAX} 个字符` })
  title?: string;

  @ApiPropertyOptional({
    description: '项目情况说明（纯文本），传空字符串表示清空',
  })
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString({ message: '项目情况说明需为字符串' })
  @MaxLength(POST_CONTENT_MAX, {
    message: `项目情况说明最长 ${POST_CONTENT_MAX} 个字符`,
  })
  content?: string;

  @ApiPropertyOptional({
    description: `标签 id（取自 /community/tags）：${POST_TAG_MIN}-${POST_TAG_MAX} 个，不可重复`,
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'tagIds 需为数组' })
  @ArrayMinSize(POST_TAG_MIN, { message: `至少选择 ${POST_TAG_MIN} 个标签` })
  @ArrayMaxSize(POST_TAG_MAX, { message: `最多选择 ${POST_TAG_MAX} 个标签` })
  @ArrayUnique({ message: '标签不能重复' })
  @IsString({ each: true, message: '标签 id 需为字符串' })
  @Matches(TAG_ID_PATTERN, { each: true, message: '标签 id 需为合法 id' })
  tagIds?: string[];

  @ApiPropertyOptional({ description: '招募人数：1-10，不得少于已招人数' })
  @IsOptional()
  @IsInt({ message: '招募人数需为整数' })
  @Min(RECRUIT_TOTAL_MIN, { message: `招募人数最少为 ${RECRUIT_TOTAL_MIN}` })
  @Max(RECRUIT_TOTAL_MAX, { message: `招募人数最多为 ${RECRUIT_TOTAL_MAX}` })
  recruitTotal?: number;
}
