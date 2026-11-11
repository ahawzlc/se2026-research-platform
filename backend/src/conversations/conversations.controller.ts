import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import {
  CreateGroupConversationDto,
  CreatePrivateConversationDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './dto/conversation.dto';
import { ListConversationsQueryDto } from './dto/conversation-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('协作沟通')
@ApiBearerAuth('bearer')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: '会话列表（含未读数，按最近活动倒序）' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.conversations.listConversations(user.userId, query);
  }

  @Post('group')
  @ApiOperation({ summary: '创建/获取项目讨论区（一个项目一个群组会话）' })
  ensureGroup(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateGroupConversationDto,
  ) {
    return this.conversations.ensureGroupConversation(user.userId, dto);
  }

  @Post('private')
  @ApiOperation({ summary: '创建/获取私信会话（双方必须在同一课题组）' })
  ensurePrivate(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreatePrivateConversationDto,
  ) {
    return this.conversations.ensurePrivateConversation(user.userId, dto);
  }

  @Get('unread')
  @ApiOperation({
    summary: '未读消息汇总（前端 30s 轮询；消息零埋点，不计入参与度）',
  })
  unread(@CurrentUser() user: CurrentUserPayload) {
    return this.conversations.listUnread(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '会话详情（含未读数）' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.conversations.detailConversation(user.userId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '会话消息列表（按时间正序）' })
  listMessages(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.conversations.listConversationMessages(
      user.userId,
      id,
      query.limit,
    );
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: '发送消息（零埋点；消息不计入参与度）',
  })
  send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.conversations.sendConversationMessage(
      user.userId,
      id,
      dto.content,
    );
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记会话已读（推进 lastReadAt）' })
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.conversations.markRead(user.userId, id);
    return { ok: true };
  }
}
