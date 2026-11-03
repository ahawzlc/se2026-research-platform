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
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { TaskCommentsService } from './task-comments.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
  UpdateTaskOrderDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** 发表评论入参 */
export class CreateCommentDto {
  @ApiProperty({ description: '评论正文：1-2000 个字符' })
  @IsString()
  @IsNotEmpty({ message: '评论内容不能为空' })
  @MaxLength(2000, { message: '评论最长 2000 个字符' })
  content!: string;
}

/** 评论列表查询参数 */
export class ListCommentsQueryDto {
  @ApiPropertyOptional({ description: '最多返回条数', default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;
}

@ApiTags('任务')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly comments: TaskCommentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '任务列表（可按项目、状态、负责人过滤）' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.list(user.userId, query);
  }

  @Post()
  @ApiOperation({ summary: '新建任务（写入 task_create 埋点）' })
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '任务详情' })
  detail(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.tasks.detail(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新任务基本信息' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除任务（逻辑删除）' })
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.tasks.remove(user.userId, id);
  }

  @Put(':id/status')
  @ApiOperation({
    summary:
      '任务状态流转（看板换列；进入 done 写 task_done 埋点且同对象只计一次）',
  })
  updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatus(user.userId, id, dto);
  }

  @Put(':id/order')
  @ApiOperation({ summary: '调整看板列内排序（整数间隔策略）' })
  updateOrder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTaskOrderDto,
  ) {
    return this.tasks.updateOrder(user.userId, id, dto);
  }

  // ---------------------------------------------------------------- 评论

  @Get(':id/comments')
  @ApiOperation({ summary: '任务下的评论列表' })
  listComments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query() query: ListCommentsQueryDto,
  ) {
    return this.comments.list(user.userId, id, query.limit);
  }

  @Post(':id/comments')
  @ApiOperation({
    summary: '发表任务评论（写 comment_create 埋点，单日上限 10 条）',
  })
  createComment(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(user.userId, id, dto.content);
  }
}
