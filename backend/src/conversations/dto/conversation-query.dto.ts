import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** 会话类型（docs/02 conversation.type） */
export const CONVERSATION_TYPES = ['comment', 'group', 'private'] as const;
export type ConversationTypeValue = (typeof CONVERSATION_TYPES)[number];

/** 会话列表查询参数 */
export class ListConversationsQueryDto {
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
    description: '按会话类型过滤',
    enum: CONVERSATION_TYPES,
  })
  @IsOptional()
  @IsIn(CONVERSATION_TYPES, { message: 'type 取值非法' })
  type?: ConversationTypeValue;
}
