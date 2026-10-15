import { SetMetadata } from '@nestjs/common';
import type { ActivityTypeValue } from './activity.constants';

export const ACTIVITY_LOG_KEY = 'activity_log';

export interface ActivityLogOptions {
  /** 行为类型，取值见 ActivityType */
  type: ActivityTypeValue;
  /** 关联对象类型（task / achievement / meeting / project ...），用于反刷分去重 */
  refType?: string;
  /** 课题组 id 从哪里取，默认取请求体里的 `teamId` */
  teamIdFrom?: 'body' | 'param' | 'query';
  teamIdKey?: string;
  /** 关联对象 id 从哪里取，默认先看响应体的 `id`，再退回请求参数 */
  refIdFrom?: 'body' | 'param' | 'query' | 'response';
  refIdKey?: string;
  /** 覆盖默认权重（默认取 ACTIVITY_DEFAULT_WEIGHT） */
  weight?: number;
}

/**
 * 在控制器方法上声明一条埋点。
 *
 * 例：
 * ```ts
 * @ActivityLog({ type: ActivityType.TASK_DONE, refType: 'task', refIdFrom: 'param', refIdKey: 'id' })
 * @Post(':id/done')
 * finish(@Param('id') id: string) { ... }
 * ```
 *
 * 注意：拦截器是在方法成功返回后写入，属于「独立写入」；
 * 若要求埋点与业务写入严格同事务（docs/03 第二节的要求），
 * 请在 service 里用 `ActivityService.recordInTransaction(tx, ...)` 显式调用。
 */
export const ActivityLog = (options: ActivityLogOptions) =>
  SetMetadata(ACTIVITY_LOG_KEY, options);
