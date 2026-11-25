import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { StatsModule } from './activity/analysis/stats.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { TeamsModule } from './teams/teams.module';
import { FileModule } from './modules/file/file.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { ConversationsModule } from './conversations/conversations.module';
import { LiteraturesModule } from './literatures/literatures.module';
import { MeetingsModule } from './meetings/meetings.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AchievementsModule } from './achievements/achievements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';
import { FriendsModule } from './friends/friends.module';
import { RateLimitModule } from './common/rate-limit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ActivityModule,
    StatsModule,
    AuthModule,
    TeamsModule,
    FileModule,
    ProjectsModule,
    TasksModule,
    ConversationsModule,
    LiteraturesModule,
    MeetingsModule,
    AchievementsModule,
    NotificationsModule,
    UsersModule,
    FriendsModule,
    // 限流能力全局可用（好友申请防骚扰用，见 RateLimitModule 注释）
    RateLimitModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
