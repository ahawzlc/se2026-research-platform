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
