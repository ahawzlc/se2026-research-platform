import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/** 课题组模块（PrismaService 为全局模块，无需显式导入） */
@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
