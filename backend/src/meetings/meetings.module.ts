import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

/** 会议模块（任务卡 C-2）；PrismaService / ActivityService 为全局模块 */
@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
