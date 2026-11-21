import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * 通知中心模块（卡 G-1，线①）。
 * NotificationsService 供线②③④注入调用 push —— PrismaService 为全局模块，无需显式导入。
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
