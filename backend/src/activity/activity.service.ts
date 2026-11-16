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
 * 埋点写入服务。业务动作追加流水，撤销只将关联流水的权重置零。
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

  /**
   * 幂等写入：同一 (type, refType, refId) 的行为，同一成员只计一次。
   *
   * 背景（docs/03 第六节反刷分设计第 1 条）：反复把同一个任务标记完成
   * 只能算一次，否则拖拽几次就能把参与度刷上去。
   *
   * 注意：已被 revoke 撤销（权重置 0）的那条不算「已计入」——
   * 任务从 done 退回 doing 后再次完成，应当**重新计一次分**，
   * 否则「撤销 → 再完成」这条路径会永久丢失该次贡献。
   *
   * @returns true 表示本次真的写入了；false 表示此前已存在有效计分的同一条行为
   */
  async recordOnce(
    client: PrismaTransactionClient | PrismaService,
    input: RecordActivityInput,
  ): Promise<boolean> {
    const userId = toBigInt(input.userId);
    const refType = input.refType ?? null;
    const refId =
      input.refId === null || input.refId === undefined
        ? null
        : toBigInt(input.refId);

    // 只有带 refId 的行为才谈得上「同对象去重」；无 ref 的行为不做去重
    if (refId === null) {
      await this.create(client, input);
      return true;
    }

    const existing = await client.activityLog.findFirst({
      where: {
        userId,
        type: input.type,
        refType,
        refId,
        // 权重为 0 表示已被撤销，不算已计入
        weight: { gt: 0 },
      },
      select: { id: true },
    });
    if (existing) {
      return false;
    }
    await this.create(client, input);
    return true;
  }

  /**
   * 撤销一条已记录的埋点（反向行为扣减）。
   *
   * 背景（docs/03 第六节第 3 条）：任务从 done 退回 doing 时，
   * 之前记的那条 task_done 不该继续计入。
   *
   * 团队共享状态（任务/里程碑）按团队和对象撤销原完成记录，
   * 个人行为（阅读/参会）仍按行为人和对象撤销。保留流水，权重置为 0。
   *
   * @returns true 表示确实撤销了一条
   */
  async revoke(
    client: PrismaTransactionClient | PrismaService,
    input: {
      type: ActivityTypeValue;
      refType?: string | null;
      refId: bigint | number | string;
    } & (
      | { userId: bigint | number | string; teamId?: never }
      | { teamId: bigint | number | string; userId?: never }
    ),
  ): Promise<boolean> {
    const refType = input.refType ?? null;
    const result = await client.activityLog.updateMany({
      where: {
        ...(input.teamId === undefined
          ? { userId: toBigInt(input.userId) }
          : { teamId: toBigInt(input.teamId) }),
        type: input.type,
        refType,
        refId: toBigInt(input.refId),
        weight: { not: 0 },
      },
      data: { weight: new Prisma.Decimal(0) },
    });
    return result.count > 0;
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
