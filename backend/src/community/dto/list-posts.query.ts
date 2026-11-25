import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { POST_STATUSES, type PostStatus } from '../community.constants';

/** 广场列表查询参数（分页约定见 docs/01 第四节：page 从 1 起，size 上限 100） */
export class ListPostsQueryDto {
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

  @ApiPropertyOptional({
    description: '标签 id，逗号分隔，命中任一即返回',
    example: '1,6',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  )
  @IsArray({ message: 'tags 需为逗号分隔的标签 id' })
  @IsString({ each: true, message: 'tags 需为逗号分隔的标签 id' })
  @Matches(/^\d{1,19}$/, {
    each: true,
    message: 'tags 需为逗号分隔的标签 id',
  })
  tags?: string[];

  @ApiPropertyOptional({
    description: '关键词，匹配标题或正文',
    example: '前端',
  })
  @IsOptional()
  @IsString({ message: 'q 需为字符串' })
  @MaxLength(100, { message: '关键词最长 100 个字符' })
  q?: string;

  @ApiPropertyOptional({
    description: '帖子状态，省略为全部',
    enum: POST_STATUSES,
  })
  @IsOptional()
  @IsIn([...POST_STATUSES], { message: 'status 取值非法' })
  status?: PostStatus;

  @ApiPropertyOptional({
    description: '只看我发布的，默认 false',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true || value === 1)
  @IsBoolean({ message: 'mine 需为布尔值' })
  mine?: boolean = false;
}
