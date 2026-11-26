/**
 * 个人主页相关常量（线③ 卡 E-3）。
 *
 * 可见范围三档：public 所有人可见 / friends 仅好友可见 / private 仅自己可见。
 */

/** 主页可见范围取值域（与 user.profile_visibility 列注释一致） */
export const PROFILE_VISIBILITIES = ['public', 'friends', 'private'] as const;

export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/** 可见范围中文名（前端展示用，后端也用于错误提示） */
export const PROFILE_VISIBILITY_LABELS: Record<ProfileVisibility, string> = {
  public: '所有人可见',
  friends: '仅好友可见',
  private: '仅自己可见',
};

/** 个人简介最大长度（与 user.bio VARCHAR(500) 对齐） */
export const BIO_MAX_LENGTH = 500;

/**
 * 对外 UID 的字符集：U 前缀 + 10 位数字。
 *
 * 选数字段而非纯随机串的原因：便于人工口述与核对（形如 U0000000123），
 * 唯一性由 uk_user_public_uid 兜底，生成时还会做一次冲突重试。
 */
export const PUBLIC_UID_PREFIX = 'U';
export const PUBLIC_UID_DIGITS = 10;
export const PUBLIC_UID_PATTERN = /^U\d{10}$/;

/** 生成一个候选 UID（不含冲突检测，冲突由调用方重试） */
export function generatePublicUid(): string {
  const max = 10 ** PUBLIC_UID_DIGITS;
  const num = Math.floor(Math.random() * max);
  return `${PUBLIC_UID_PREFIX}${String(num).padStart(PUBLIC_UID_DIGITS, '0')}`;
}

/**
 * 头像地址允许的本站前缀（评审意见 D2）。
 *
 * 头像会在**所有看到它的人的浏览器**里加载——顶栏、好友列表、组队广场卡片，
 * 每一处都是一个自动发起的外部请求。若允许存外站 URL，
 * 攻击者就能借用户的头像位收集访问者的 IP / Referer（甚至做 CSRF 侧的探测）。
 *
 * 因此头像只接受本站文件上传接口（`/api/v1/files/...`）返回的相对地址。
 * 空串是合法值——表示「用昵称首字母生成默认头像」。
 */
export const AVATAR_ALLOWED_PREFIX = '/api/v1/files/';

/**
 * 校验头像地址是否可接受。
 *
 * @returns true 表示可以落库
 */
export function isAllowedAvatarUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true; // 空串 = 用默认头像
  }
  // 必须是本站相对路径，且以允许的前缀开头。
  // 顺带挡掉协议相对地址（//evil.com/x.png）与任何绝对 URL。
  if (trimmed.startsWith('//')) {
    return false;
  }
  if (!trimmed.startsWith('/')) {
    return false;
  }
  return trimmed.startsWith(AVATAR_ALLOWED_PREFIX);
}
