import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 创建/获取项目讨论区入参 */
export class CreateGroupConversationDto {
  @ApiProperty({ description: '项目 id（一个项目一个讨论区）' })
  @IsString()
  @IsNotEmpty({ message: 'projectId 不能为空' })
  projectId!: string;
}

/** 创建/获取私信会话入参 */
export class CreatePrivateConversationDto {
  @ApiProperty({ description: '对方 userId' })
  @IsString()
  @IsNotEmpty({ message: 'peerUserId 不能为空' })
  peerUserId!: string;
}

/**
 * 按 UID 打开/创建私信会话入参（线③ 卡 E-3）。
 *
 * 好友页点「发私信」时，前端手里只有对方的 UID（不暴露 user.id），
 * 故提供按 UID 的入口，服务层先解析 UID 再走既有的 private 会话流程。
 */
export class OpenPrivateConversationByUidDto {
  @ApiProperty({ description: '对方 UID，形如 U0000000123' })
  @IsString()
  @IsNotEmpty({ message: 'uid 不能为空' })
  @MaxLength(20, { message: 'uid 最长 20 个字符' })
  @Matches(/^U\d{10}$/, {
    message: 'UID 格式不正确（应为 U 开头 + 10 位数字）',
  })
  uid!: string;
}

/** 发消息入参 */
export class SendMessageDto {
  @ApiProperty({ description: '消息正文：1-2000 个字符' })
  @IsString()
  @IsNotEmpty({ message: '消息内容不能为空' })
  @MaxLength(2000, { message: '消息最长 2000 个字符' })
  content!: string;
}

/** 拉取消息查询参数 */
export class ListMessagesQueryDto {
  @ApiPropertyOptional({ description: '最多返回条数，1-200', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 需为整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;
}
