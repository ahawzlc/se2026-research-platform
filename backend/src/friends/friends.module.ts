import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * 好友模块（线③ 卡 E-3）。
 *
 * 依赖 NotificationsModule：好友申请/通过要调 G-1 冻结的 push 接口发通知。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
