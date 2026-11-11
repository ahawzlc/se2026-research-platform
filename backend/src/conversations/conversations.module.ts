import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * 会话模块（统一会话模型）。
 *
 * B-3 任务评论与 C-5 协作消息共用本模块：
 *   - B-3 只注入 Service，复用锚定评论；
 *   - C-5 额外注册 Controller，提供群组、私信、未读、已读接口。
 */
@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
