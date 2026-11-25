import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingReminderService } from './meeting-reminder.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** 会议模块（任务卡 C-2）；PrismaService / ActivityService 为全局模块 */
@Module({
  imports: [NotificationsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingReminderService],
  exports: [MeetingReminderService],
})
export class MeetingsModule {}
