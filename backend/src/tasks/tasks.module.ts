import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** 任务模块（任务卡 B-2） */
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
