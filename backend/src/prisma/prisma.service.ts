import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端封装。
 *
 * 约定：
 *   1. 所有表都有 `deleted` 逻辑删除标记，**Prisma 不会自动过滤**，
 *      业务查询必须显式写 `where: { deleted: 0 }`；
 *   2. 数据库层没有外键，表间关系由应用层保证（schema.prisma 里的 relation
 *      只是逻辑关系，用于支持 include 联表查询）。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('数据库连接成功');
    } catch (error) {
      // 不阻断启动：便于在 Docker/MySQL 尚未启动时先跑通接口与文档
      this.logger.warn(
        `数据库连接失败，服务仍会启动，但涉及数据的接口会报错。原因：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** 健康检查用：探测数据库是否可用 */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
