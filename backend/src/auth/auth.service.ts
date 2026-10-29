import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BizException } from '../common/result';
import { formatDateTime, toIdString } from '../common/datetime';
import { isUniqueViolation } from '../common/prisma-errors';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

/** JWT 载荷：sub 为用户主键（字符串形式，避免超出 Number 精度） */
export interface JwtPayload {
  sub: string;
  username: string;
  /** 课题组角色快照，仅用于粗粒度校验，最终权限以 team_member 表为准 */
  roles?: string[];
}

export interface SignTokenInput {
  userId: bigint | number | string;
  username: string;
  roles?: string[];
}

/** 对外暴露的用户信息（绝不含 passwordHash） */
export interface SafeUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
}

/** 注册 / 登录的成功返回：注册即登录态，前端 LoginResult 按此形状消费 */
export interface AuthResult {
  token: string;
  tokenType: 'Bearer';
  /** 有效期（秒），供前端提示 */
  expiresIn: number;
  user: SafeUser;
}

/** GET /auth/me 的返回：在 SafeUser 基础上附格式化后的注册时间 */
export interface UserProfile extends SafeUser {
  createdAt: string;
}

/** bcrypt 计算成本；课程项目取 10（约 100ms/次），兼顾安全与本地联调速度 */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * 鉴权服务：令牌签发校验 + 注册 / 登录 / 当前用户（任务卡 A-1）。
 *
 * 按红线约定：注册与登录不产生任何埋点（ActivityType 固定 9 类，无对应类型）。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------- 令牌

  /** 签发访问令牌 */
  async sign(input: SignTokenInput): Promise<string> {
    const payload: JwtPayload = {
      sub: String(input.userId),
      username: input.username,
      roles: input.roles ?? [],
    };
    return this.jwt.signAsync(payload);
  }

  /** 校验令牌并返回载荷；失败会抛异常 */
  async verify(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token);
  }

  /** 令牌有效期（秒），用于前端提示 */
  get expiresInSeconds(): number {
    return Number(this.config.get<string>('JWT_EXPIRES_IN_SECONDS', '604800'));
  }

  // ---------------------------------------------------------------- 业务

  /** 注册：用户名唯一（预查 + 唯一索引双保险），密码只存 bcrypt 哈希 */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findFirst({
      where: { username: dto.username, deleted: 0 },
      select: { id: true },
    });
    if (existing) {
      throw BizException.conflict('用户名已存在');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          username: dto.username,
          passwordHash,
          nickname: dto.nickname,
          email: dto.email ?? '',
        },
      });
    } catch (error) {
      // 并发注册同一用户名时由唯一索引兜底，仍按 409 返回
      if (isUniqueViolation(error)) {
        throw BizException.conflict('用户名已存在');
      }
      throw error;
    }
    return this.issueAuthResult(user);
  }

  /** 登录：用户不存在 / 密码错误 / 账号已删统一报错，不泄露可探测信息 */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username, deleted: 0 },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw BizException.unauthorized('用户名或密码错误');
    }
    return this.issueAuthResult(user);
  }

  /** 当前用户：按令牌载荷查库，账号已删除则视为登录态失效 */
  async me(userId: string): Promise<UserProfile> {
    const user = await this.findActiveUser(userId);
    return {
      ...this.toSafeUser(user),
      createdAt: formatDateTime(user.createdAt),
    };
  }

  // ---------------------------------------------------------------- 内部

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

  private async issueAuthResult(user: User): Promise<AuthResult> {
    const roles = await this.loadRoleSnapshot(user.id);
    const token = await this.sign({
      userId: user.id,
      username: user.username,
      roles,
    });
    return {
      token,
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
      user: this.toSafeUser(user),
    };
  }

  /** 令牌 roles 只是入组角色快照（去重），细粒度权限校验一律查 team_member */
  private async loadRoleSnapshot(userId: bigint): Promise<string[]> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId, deleted: 0 },
      select: { role: true },
    });
    return [...new Set(memberships.map((item) => item.role))];
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: toIdString(user.id),
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
    };
  }
}
