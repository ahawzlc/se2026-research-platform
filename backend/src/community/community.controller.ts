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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunityPostsService } from './posts.service';
import { CommunityApplicationsService } from './applications.service';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';
import { ListPostsQueryDto } from './dto/list-posts.query';
import { ApplyPostDto } from './dto/apply-post.dto';
import { ListApplicationsQueryDto } from './dto/list-applications.query';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('组队广场')
@ApiBearerAuth('bearer')
@Controller('community')
export class CommunityController {
  constructor(
    private readonly posts: CommunityPostsService,
    private readonly applications: CommunityApplicationsService,
  ) {}

  @Get('tags')
  @ApiOperation({ summary: '标签字典（竞赛 / 课程两类）' })
  listTags() {
    return this.posts.listTags();
  }

  @Get('posts')
  @ApiOperation({
    summary: '广场列表（分页；可按标签、关键词、状态、只看我的过滤）',
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListPostsQueryDto,
  ) {
    return this.posts.list(user.userId, query);
  }

  @Post('posts')
  @ApiOperation({ summary: '发布招募帖（标签必选 1-3 个）' })
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePostDto) {
    return this.posts.create(user.userId, dto);
  }

  @Get('posts/:id')
  @ApiOperation({ summary: '帖子详情（全站登录用户可见）' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.posts.detail(user.userId, id);
  }

  @Put('posts/:id')
  @ApiOperation({ summary: '编辑帖子（仅发帖人，仅「招募中」可编辑）' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.posts.update(user.userId, id, dto);
  }

  @Post('posts/:id/close')
  @ApiOperation({ summary: '停止招募（仅发帖人，转入「已停止」）' })
  close(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.posts.close(user.userId, id);
  }

  @Delete('posts/:id')
  @ApiOperation({
    summary: '删除帖子（仅发帖人，逻辑删除；还有待处理申请时 409）',
  })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.posts.remove(user.userId, id);
  }

  @Post('posts/:id/apply')
  @ApiOperation({
    summary: '申请加入（仅「招募中」的他人帖子，每人每帖至多一条）',
  })
  apply(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ApplyPostDto,
  ) {
    return this.applications.apply(user.userId, id, dto);
  }

  @Get('posts/:id/applications')
  @ApiOperation({ summary: '该帖的申请列表（分页；仅发帖人）' })
  listApplications(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ListApplicationsQueryDto,
  ) {
    return this.applications.list(user.userId, id, query);
  }

  @Post('applications/:id/approve')
  @ApiOperation({
    summary: '通过申请（仅发帖人）：自动建组入组、进度 +1、招满转「已满员」',
  })
  approve(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.applications.approve(user.userId, id);
  }

  @Post('applications/:id/reject')
  @ApiOperation({ summary: '拒绝申请（仅发帖人）' })
  reject(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.applications.reject(user.userId, id);
  }
}
