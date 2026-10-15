declare global {
  interface BigInt {
    toJSON(): string;
  }
}

let enabled = false;

/**
 * 让 JSON.stringify 能处理 BigInt。
 *
 * 背景：Prisma 的 BIGINT UNSIGNED 主键（如 `user.id`、`file.size`）查出来是 JS 的 BigInt，
 * 而 JSON.stringify 遇到 BigInt 会直接抛 `TypeError: Do not know how to serialize a BigInt`，
 * 导致所有返回实体的接口 500。
 *
 * 处理方式：把 BigInt 序列化成**字符串**
 *   - 与 JWT 载荷里的 `sub`（字符串）保持一致；
 *   - 避免超过 2^53 时的精度丢失（选 BIGINT 本来就是为了这个）；
 *   - 前端 id 一律按字符串处理（见 `frontend/src/api/types.ts`）。
 *
 * 由 `main.ts` 在启动时调用一次。幂等，重复调用无副作用。
 */
export function enableBigIntJsonSerialization(): void {
  if (enabled) {
    return;
  }
  BigInt.prototype.toJSON = function (this: bigint): string {
    return this.toString();
  };
  enabled = true;
}
