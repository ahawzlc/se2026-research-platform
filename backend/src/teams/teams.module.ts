import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/**
 * 课题组模块（PrismaService 为全局模块，无需显式导入）。
 * TeamsService 供组队广场（卡 E-2 审批通过后自动建组 / 入组）在业务事务内复用。
 */
@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
