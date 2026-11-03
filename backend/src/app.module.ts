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
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    // 全局配置：优先读 .env.local（本地覆盖），其次 .env
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
    // B 线：项目与里程碑（B-1）
    ProjectsModule,
    // B 线：任务看板（B-2）
    TasksModule,
    // B 线：统一会话模型（B-3，与 C-5 协作消息共用）
    ConversationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // 全局默认鉴权：除显式标注 @Public() 的接口外，都要求携带有效 token
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
