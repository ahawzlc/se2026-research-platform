import type { CommunityPost } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { parseId } from '../common/team-access';

/**
 * 组队帖子的访问校验（帖子服务与申请服务共用）。
 *
 * 社区是跨组公开内容：帖子对全站登录用户可见，所以这里不做团队归属校验；
 * 但编辑 / 停止 / 删除 / 审批的权限必须按「作者本人」判断（红线 9 在此的归属条件即发帖人）。
 */

/** 按路径 id 取未删除的帖子；不存在、已删除、id 非法一律 404 */
export async function requireVisiblePost(
  prisma: PrismaService,
  idParam: string,
): Promise<CommunityPost> {
  const id = parseId(idParam);
  const post = id
    ? await prisma.communityPost.findFirst({ where: { id, deleted: 0 } })
    : null;
  if (!post) {
    throw BizException.notFound('帖子不存在');
  }
  return post;
}

/** 改删 / 审批权限：仅发帖人本人 */
export function requirePostAuthor(
  post: { userId: bigint },
  userId: string,
): void {
  if (post.userId !== BigInt(userId)) {
    throw BizException.forbidden('仅发帖人可执行此操作');
  }
}
