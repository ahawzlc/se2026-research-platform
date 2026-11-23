import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityPostsService } from './posts.service';

/**
 * 组队广场模块（线②，卡 E-1 / E-2）。
 * PrismaService 为全局模块，无需显式导入。
 */
@Module({
  controllers: [CommunityController],
  providers: [CommunityPostsService],
})
export class CommunityModule {}
