import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.query';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('通知中心')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: '我的通知列表（分页，unreadOnly 仅看未读，按 id 倒序）',
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读数（顶栏铃铛 30s 轮询）' })
  unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.notifications.unreadCount(user.userId);
  }

  @Post(':id/read')
  @ApiOperation({ summary: '单条已读（幂等；非本人通知按 404 处理）' })
  read(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.notifications.markRead(id, user.userId);
  }

  @Post('read-all')
  @ApiOperation({ summary: '全部已读（返回本次标记条数）' })
  readAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notifications.markAllRead(user.userId);
  }
}
