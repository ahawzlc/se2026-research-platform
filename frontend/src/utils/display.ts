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

/**
 * 附件大小格式化（字节数 → 可读文本）。
 *
 * 后端 BIGINT 序列化成字符串，故入参是 string；非法值一律回退为 '0 B'，
 * 不抛错——附件卡片是展示性的，一个坏的大小不该让整条消息渲染失败。
 *
 * 口径：< 1KB 显示字节；< 1MB 显示 KB（一位小数）；更大显示 MB / GB（一位小数）。
 * 恰好 1024 的进位边界：1023 B → '1023 B'，1024 B → '1.0 KB'。
 */
export function formatFileSize(size: string | number | undefined | null): string {
    const bytes = typeof size === 'string' ? Number(size) : (size ?? Number.NaN)
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B'
    }
    if (bytes < 1024) {
        return `${Math.floor(bytes)} B`
    }
    const kb = bytes / 1024
    if (kb < 1024) {
        return `${kb.toFixed(1)} KB`
    }
    const mb = kb / 1024
    if (mb < 1024) {
        return `${mb.toFixed(1)} MB`
    }
    return `${(mb / 1024).toFixed(1)} GB`
}
