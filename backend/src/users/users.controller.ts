import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { FindUserByUidDto } from './dto/find-user-by-uid.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('个人主页')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: '我的主页（昵称/头像/简介/UID/可见范围，含我与自己的关系）',
  })
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.users.myProfile(user.userId);
  }

  @Put('me')
  @ApiOperation({
    summary: '更新我的主页资料（昵称/头像/简介/可见范围；UID 与用户名不可改）',
  })
  updateMe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.users.updateMyProfile(user.userId, dto);
  }

  @Get('by-uid')
  @ApiOperation({
    summary: '按 UID 查询用户（好友页"通过 UID 添加好友"用）',
  })
  byUid(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: FindUserByUidDto,
  ) {
    return this.users.profileByUid(user.userId, query.uid);
  }

  @Get(':id')
  @ApiOperation({
    summary: '查看他人主页（可见范围由对方设置决定：public/friends/private）',
  })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.users.profileById(user.userId, id);
  }
}
