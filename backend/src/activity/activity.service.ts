import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVITY_DEFAULT_WEIGHT,
  ActivityTypeValue,
} from './activity.constants';

export interface RecordActivityInput {
  userId: bigint | number | string;
  teamId: bigint | number | string;
  type: ActivityTypeValue;
  refType?: string | null;
  refId?: bigint | number | string | null;
  weight?: number;
}

/** Prisma 事务客户端类型，便于在业务事务内写埋点 */
export type PrismaTransactionClient = Prisma.TransactionClient;

/**
 * 埋点写入服务。activity_log 只增不改，任何业务写操作都应留下痕迹。
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 独立写入（不参与业务事务）。埋点失败只告警，不影响业务成功。
   * 适合非关键路径；要求强一致的场景请用 recordInTransaction。
   */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await this.create(this.prisma, input);
    } catch (error) {
      this.logger.warn(
        `埋点写入失败 type=${input.type} userId=${String(input.userId)}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 在业务事务内写入埋点（推荐）。
   *
   * 例：
   * ```ts
   * await this.prisma.$transaction(async (tx) => {
   *   const task = await tx.task.update({ ... });
   *   await this.activity.recordInTransaction(tx, {
   *     userId, teamId, type: ActivityType.TASK_DONE, refType: 'task', refId: task.id,
   *   });
   * });
   * ```
   */
  async recordInTransaction(
    tx: PrismaTransactionClient,
    input: RecordActivityInput,
  ): Promise<void> {
    await this.create(tx, input);
  }

  private async create(
    client: PrismaTransactionClient | PrismaService,
    input: RecordActivityInput,
  ): Promise<void> {
    await client.activityLog.create({
      data: {
        userId: toBigInt(input.userId),
        teamId: toBigInt(input.teamId),
        type: input.type,
        refType: input.refType ?? null,
        refId:
          input.refId === null || input.refId === undefined
            ? null
            : toBigInt(input.refId),
        weight: new Prisma.Decimal(
          input.weight ?? ACTIVITY_DEFAULT_WEIGHT[input.type] ?? 1,
        ),
      },
    });
  }
}

function toBigInt(value: bigint | number | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
