import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { ListMembersQueryDto } from './dto/list-members.query';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('课题组')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @ApiOperation({ summary: '创建课题组（当前用户成为组长，返回邀请码）' })
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTeamDto) {
    return this.teams.createTeam(user.userId, dto);
  }

  @Post('join')
  @ApiOperation({ summary: '凭邀请码加入课题组' })
  join(@CurrentUser() user: CurrentUserPayload, @Body() dto: JoinTeamDto) {
    return this.teams.join(user.userId, dto);
  }

  @Get('my')
  @ApiOperation({ summary: '当前用户加入的课题组列表（含本人角色）' })
  my(@CurrentUser() user: CurrentUserPayload) {
    return this.teams.myTeams(user.userId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: '课题组成员列表（分页，仅本组成员可看）' })
  members(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.teams.listMembers(id, user.userId, query);
  }

  @Put(':id/members/:userId/role')
  @ApiOperation({ summary: '修改成员角色（仅组长可操作）' })
  updateRole(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.teams.updateMemberRole(id, user.userId, userId, dto);
  }
}
