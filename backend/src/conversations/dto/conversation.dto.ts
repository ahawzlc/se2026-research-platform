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

/**
 * 创建/获取会议讨论区入参（线③ 卡 F-1）。
 *
 * 会话类型用 G-0 定稿的 `meeting`，refType/refId 指向会议；
 * 表结构不因本卡改动。
 */
export class CreateMeetingConversationDto {
  @ApiProperty({ description: '会议 id' })
  @IsString()
  @IsNotEmpty({ message: 'meetingId 不能为空' })
  meetingId!: string;
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
 * 好友页点「发私信」时，前端手里只有对方的 UID，故提供按 UID 的入口，
 * 服务层先解析 UID 再走既有的 private 会话流程。
 *
 * 注：返回的会话信息里带 `id`（内部主键），这是正常的——
 * 「不暴露 id」指的是**入口参数**只认 UID，不提供「按 id 打开会话」的公开接口
 * （评审意见 C2③）。
 */
export class OpenPrivateConversationByUidDto {
  @ApiProperty({ description: '对方 UID，形如 U0000000123（大小写均可）' })
  @IsString()
  @IsNotEmpty({ message: 'uid 不能为空' })
  @MaxLength(20, { message: 'uid 最长 20 个字符' })
  @Matches(/^[Uu]\d{10}$/, {
    message: 'UID 格式不正确（应为 U 开头 + 10 位数字）',
  })
  uid!: string;
}

/**
 * 发消息入参。
 *
 * 附件（线③ 收尾，文件消息）：
 *   - 带 `fileId` 时消息类型为 `file`，附件本体落在 `file` 表，
 *     `content` 存一句说明（如「会议纪要」）；
 *   - 不带 `fileId` 时为普通文本消息；
 *   - 两者都不给 → 400（空消息无意义）。
 *
 * `fileId` 只能引用**自己**上传的附件，避免把别人的文件挂到自己的消息上。
 */
export class SendMessageDto {
  @ApiProperty({ description: '消息正文：1-2000 个字符' })
  @IsString()
  @IsNotEmpty({ message: '消息内容不能为空' })
  @MaxLength(2000, { message: '消息最长 2000 个字符' })
  content!: string;

  @ApiPropertyOptional({
    description: '附件 id（file.id）；带上后消息类型为 file',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'fileId 不能为空' })
  @MaxLength(20, { message: 'fileId 最长 20 个字符' })
  @Matches(/^\d+$/, { message: 'fileId 非法' })
  fileId?: string;
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
