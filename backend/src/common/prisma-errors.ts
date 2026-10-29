/** Prisma 错误判断辅助，供业务模块捕获数据库层约束冲突时复用 */

/** P2002 = 唯一索引冲突（并发写入兜底，正常流程应先查再写） */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
