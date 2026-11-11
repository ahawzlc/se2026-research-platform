import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { MilestonesService } from './milestones.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import {
  ListMilestonesQueryDto,
  ListProjectsQueryDto,
} from './dto/project-query.dto';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/milestone.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('项目')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly milestones: MilestonesService,
  ) {}

  @Get()
  @ApiOperation({ summary: '项目列表（分页，仅返回本课题组的项目）' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projects.list(user.userId, query);
  }

  @Post()
  @ApiOperation({ summary: '创建项目（创建者自动成为项目成员）' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '项目详情（含成员列表）' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.projects.detail(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新项目' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除项目（逻辑删除）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.projects.remove(user.userId, id);
  }

  // ---------------------------------------------------------------- 里程碑

  @Get(':id/milestones')
  @ApiOperation({ summary: '项目的里程碑列表' })
  listMilestones(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ListMilestonesQueryDto,
  ) {
    return this.milestones.list(user.userId, id, query);
  }

  // ---------------------------------------------------------------- 项目成员

  @Get(':id/members')
  @ApiOperation({ summary: '项目成员列表（须为本课题组成员）' })
  listMembers(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.projects.listMembers(user.userId, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: '添加项目成员（须为本课题组成员）' })
  addMember(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.projects.addMember(user.userId, id, body.userId);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: '移除项目成员' })
  removeMember(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.projects.removeMember(user.userId, id, userId);
  }
}

@ApiTags('里程碑')
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Post()
  @ApiOperation({ summary: '创建里程碑' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.milestones.create(user.userId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新里程碑（置为已完成时写 milestone_done 埋点）' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.milestones.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除里程碑（逻辑删除）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.milestones.remove(user.userId, id);
  }
}
