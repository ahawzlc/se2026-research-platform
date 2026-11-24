/**
 * 社区名片上的称呼。
 *
 * 发布人 / 申请人名片只带昵称与头像（跨组公开内容不暴露登录名，见 docs/01 组队广场一节），
 * 所以昵称为空时没有登录名可以回退，只能显示占位——`PUT /users/me`（线③）允许把昵称改成空串。
 */
export const EMPTY_NICKNAME = '未设置昵称'

export function displayNickname(nickname: string): string {
  return nickname.trim() || EMPTY_NICKNAME
}
