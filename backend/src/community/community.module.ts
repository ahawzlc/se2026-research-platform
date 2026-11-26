import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityPostsService } from './posts.service';
import { CommunityApplicationsService } from './applications.service';
import { TeamsModule } from '../teams/teams.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * 组队广场模块（线②，卡 E-1 / E-2）。
 * PrismaService 为全局模块，无需显式导入。
 * 审批通过要「自动建组 + 入组 + 写通知」：复用 teams 与 notifications 的服务，
 * 在本模块的业务事务内调用（卡 E-2）。
 */
@Module({
  imports: [TeamsModule, NotificationsModule],
  controllers: [CommunityController],
  providers: [CommunityPostsService, CommunityApplicationsService],
})
export class CommunityModule {}
