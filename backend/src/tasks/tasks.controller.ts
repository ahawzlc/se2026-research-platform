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
import { TasksService } from './tasks.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
  UpdateTaskOrderDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@ApiTags('任务')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

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
}
