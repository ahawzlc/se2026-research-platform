import { Module } from '@nestjs/common';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

/** 成果模块（任务卡 C-3）；PrismaService / ActivityService 为全局模块 */
@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService],
})
export class AchievementsModule {}
