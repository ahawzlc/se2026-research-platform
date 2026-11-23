import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { parseId } from '../common/team-access';
import { areFriends } from '../common/friendship-access';
import {
  generatePublicUid,
  PROFILE_VISIBILITIES,
  type ProfileVisibility,
} from './user.constants';
import type { UpdateUserProfileDto } from './dto/update-user-profile.dto';

/** 我与对方的关系 */
export type UserRelation =
  'none' | 'pending_sent' | 'pending_received' | 'friends';

/** 对外暴露的用户主页资料（绝不含 passwordHash） */
export interface UserProfileView {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  /** 对外 UID，唯一且创建后不可变 */
  publicUid: string;
  bio: string;
  /** 主页可见范围 */
  profileVisibility: ProfileVisibility;
  createdAt: string;
  /** 我与该用户的关系 */
  relation: UserRelation;
  /** 是否为当前登录用户本人 */
  isSelf: boolean;
}

/**
 * 个人主页服务（线③ 卡 E-3）。
 *
 * 覆盖三件事：
 *   1. 我的主页：查看/修改自己的资料（昵称、头像、简介、可见范围）；
 *   2. 他人主页：按 id 或 UID 查看，可见范围由 profileVisibility 决定；
 *   3. UID 分配：注册时自动分配，存量用户由迁移脚本回填。
 *
 * **可见范围判定**（红线 9 的延伸）：
 *   - public：所有登录用户可见；
 *   - friends：仅互为好友的用户可见；
 *   - private：仅本人可见。
 *   判定一律回查 friendship 表，不依赖前端传参。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ================================================================ 我的主页

  /** 当前登录用户的完整主页信息 */
  async myProfile(userId: string): Promise<UserProfileView> {
    const user = await this.findActiveUser(userId);
    return this.toProfileView(user, { relation: 'none', isSelf: true });
  }

  /**
   * 更新我的主页资料。
   *
   * 只允许改 nickname / avatar / bio / profileVisibility 四项；
   * publicUid 与 username 均不可改（UID 创建后不可变是本卡的明确决策）。
   */
  async updateMyProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileView> {
    const hasAny =
      dto.nickname !== undefined ||
      dto.avatar !== undefined ||
      dto.bio !== undefined ||
      dto.profileVisibility !== undefined;
    if (!hasAny) {
      throw BizException.param('请至少提供要修改的字段');
    }

    const user = await this.findActiveUser(userId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.nickname !== undefined
          ? { nickname: dto.nickname.trim() }
          : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar.trim() } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() } : {}),
        ...(dto.profileVisibility !== undefined
          ? { profileVisibility: dto.profileVisibility }
          : {}),
      },
    });
    return this.toProfileView(updated, { relation: 'none', isSelf: true });
  }

  // ================================================================ 他人主页

  /** 按用户 id 查看主页 */
  async profileById(
    viewerId: string,
    idParam: string,
  ): Promise<UserProfileView> {
    const id = parseId(idParam);
    if (id === null) {
      throw BizException.notFound('用户不存在');
    }
    const user = await this.prisma.user.findFirst({
      where: { id, deleted: 0 },
    });
    if (!user) {
      throw BizException.notFound('用户不存在');
    }
    return this.buildViewForViewer(viewerId, user);
  }

  /** 按 UID 查看主页（好友页"通过 UID 添加好友"时先查人） */
  async profileByUid(viewerId: string, uid: string): Promise<UserProfileView> {
    const normalized = uid.trim().toUpperCase();
    const user = await this.prisma.user.findFirst({
      where: { publicUid: normalized, deleted: 0 },
    });
    if (!user) {
      throw BizException.notFound('该 UID 不存在');
    }
    return this.buildViewForViewer(viewerId, user);
  }

  // ================================================================ 内部

  /** 组装"给查看者看的"主页：先判可见范围，再算关系 */
  private async buildViewForViewer(
    viewerId: string,
    user: User,
  ): Promise<UserProfileView> {
    const viewer = BigInt(viewerId);
    const isSelf = viewer === user.id;

    if (!isSelf) {
      const visibility = user.profileVisibility as ProfileVisibility;
      // 脏数据兜底：不在取值域内时按最严格口径处理
      if (!PROFILE_VISIBILITIES.includes(visibility)) {
        throw BizException.forbidden('该用户的主页不可见');
      }
      if (visibility === 'private') {
        throw BizException.forbidden('该用户的主页不可见');
      }
      if (visibility === 'friends') {
        const friends = await areFriends(this.prisma, viewer, user.id);
        if (!friends) {
          throw BizException.forbidden('该用户的主页仅好友可见');
        }
      }
    }

    const relation = await this.relationBetween(viewer, user.id);
    return this.toProfileView(user, { relation, isSelf });
  }

  /**
   * 计算「我与对方」的关系。
   *
   * 与 friendship-access 的状态机一致：
   *   - accepted（任一方向）→ friends；
   *   - pending 且我是 requester → pending_sent；
   *   - pending 且我是 addressee → pending_received；
   *   - 否则 none。
   */
  private async relationBetween(
    viewerId: bigint,
    targetId: bigint,
  ): Promise<UserRelation> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        deleted: 0,
        OR: [
          { requesterId: viewerId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: viewerId },
        ],
      },
      select: { requesterId: true, addresseeId: true, status: true },
    });

    if (rows.length === 0) return 'none';
    if (rows.some((row) => row.status === 'accepted')) return 'friends';

    const pending = rows.find((row) => row.status === 'pending');
    if (!pending) return 'none';
    return pending.requesterId === viewerId
      ? 'pending_sent'
      : 'pending_received';
  }

  /** 把用户行转成对外视图 */
  private toProfileView(
    user: User,
    extra: { relation: UserRelation; isSelf: boolean },
  ): UserProfileView {
    return {
      id: toIdString(user.id),
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      publicUid: user.publicUid ?? '',
      bio: user.bio,
      profileVisibility: (user.profileVisibility ??
        'public') as ProfileVisibility,
      createdAt: formatDateTime(user.createdAt),
      relation: extra.relation,
      isSelf: extra.isSelf,
    };
  }

  /** 校验 id 形态并查找未删除用户 */
  private async findActiveUser(userId: string): Promise<User> {
    if (!/^\d+$/.test(userId)) {
      throw BizException.unauthorized();
    }
    const user = await this.prisma.user.findFirst({
      where: { id: BigInt(userId), deleted: 0 },
    });
    if (!user) {
      throw BizException.unauthorized('账号不存在或已被删除');
    }
    return user;
  }

  /**
   * 为用户分配 UID（注册时调用）。
   *
   * 冲突时重试：10 位数字空间有 100 亿，随机命中概率极低，
   * 但唯一索引是硬约束，必须处理冲突而不是让它抛 500。
   */
  async allocatePublicUid(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generatePublicUid();
      const exists = await this.prisma.user.findFirst({
        where: { publicUid: candidate },
        select: { id: true },
      });
      if (!exists) {
        return candidate;
      }
    }
    throw BizException.internal('UID 分配失败，请重试');
  }
}
