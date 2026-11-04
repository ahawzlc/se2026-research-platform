import { Module } from '@nestjs/common';
import { LiteraturesController } from './literatures.controller';
import { LiteraturesService } from './literatures.service';

/** 文献模块（任务卡 C-1）；PrismaService / ActivityService 为全局模块 */
@Module({
  controllers: [LiteraturesController],
  providers: [LiteraturesService],
})
export class LiteraturesModule {}
