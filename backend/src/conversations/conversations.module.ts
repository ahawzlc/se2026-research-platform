import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * 会话模块（统一会话模型的公共实现）。
 *
 * B 组的任务评论与 C 组的成果/会议评论都复用这里的锚定会话逻辑，
 * 因此单独成模块并导出服务。
 */
@Module({
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
