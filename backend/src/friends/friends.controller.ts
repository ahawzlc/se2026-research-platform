import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('好友')
@ApiBearerAuth('bearer')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  @ApiOperation({ summary: '我的好友列表（accepted 关系）' })
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.friends.listFriends(user.userId);
  }

  @Get('requests')
  @ApiOperation({
    summary: '好友申请列表（incoming 对方申请我 / outgoing 我申请对方）',
  })
  requests(@CurrentUser() user: CurrentUserPayload) {
    return this.friends.listRequests(user.userId);
  }

  @Post('requests')
  @ApiOperation({
    summary: '通过 UID 发起好友申请（对方收到铃铛通知）',
  })
  createRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateFriendRequestDto,
  ) {
    return this.friends.createRequest(user.userId, dto);
  }

  @Post('requests/:id/accept')
  @ApiOperation({ summary: '同意好友申请（申请方收到通过通知）' })
  accept(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.friends.acceptRequest(user.userId, id);
  }

  @Post('requests/:id/reject')
  @ApiOperation({ summary: '拒绝好友申请（静默，不发通知；对方可再次申请）' })
  async reject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.friends.rejectRequest(user.userId, id);
    return;
  }

  @Delete(':id')
  @ApiOperation({
    summary: '删除好友（逻辑删除，双方列表同时不可见）',
  })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.friends.removeFriend(user.userId, id);
    return;
  }
}
