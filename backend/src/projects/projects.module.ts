import { Module } from '@nestjs/common';
import {
  MilestonesController,
  ProjectsController,
} from './projects.controller';
import { ProjectsService } from './projects.service';
import { MilestonesService } from './milestones.service';

/** 项目与里程碑模块（任务卡 B-1） */
@Module({
  controllers: [ProjectsController, MilestonesController],
  providers: [ProjectsService, MilestonesService],
})
export class ProjectsModule {}
