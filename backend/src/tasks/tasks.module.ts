import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskCommentsService } from './task-comments.service';
import { ConversationsModule } from '../conversations/conversations.module';

/** 任务与任务评论模块（任务卡 B-2、B-3） */
@Module({
  imports: [ConversationsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskCommentsService],
})
export class TasksModule {}
