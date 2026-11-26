<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * 用户头像（线③ 卡 E-3）。
 *
 * 优先显示 user.avatar（走统一文件上传拿到的 URL）；
 * 没有上传头像时，用昵称首字母生成彩色默认头像——
 * 新注册用户默认就有头像，不会出现一片空白。
 *
 * ## 兜底策略
 *
 * 1. **加载失败兜底**（评审建议）：头像地址可能已失效（文件被删、URL 写错），
 *    `<el-avatar>` 直接渲染会显示破图。这里监听 `@error`，
 *    把 src 清空、退回首字母头像——总比破图好。
 * 2. **不展示登录名**（评审意见 C2②）：后端在他人视角不返回 username，
 *    所以兜底只用昵称与 UID，不再有 username 这一路。
 */
const props = withDefaults(
  defineProps<{
    /** 头像 URL；为空则用首字母生成默认头像 */
    src?: string
    /** 昵称，优先用于取首字母 */
    nickname?: string
    /** UID，昵称为空时的兜底（后端他人视角不返回 username） */
    publicUid?: string
    /** 头像尺寸（像素） */
    size?: number
    /** 圆角：圆形头像传 true */
    round?: boolean
  }>(),
  {
    src: '',
    nickname: '',
    publicUid: '',
    size: 40,
    round: true
  }
)

/** 当前实际使用的图片地址；加载失败时置空以退回首字母头像 */
const imageSrc = ref(props.src)

// src 变化时重置（切换用户 / 重新保存头像后）
watch(
  () => props.src,
  (val) => {
    imageSrc.value = val
  }
)

/** 图片加载失败：退回首字母头像，避免破图 */
function handleError(): void {
  imageSrc.value = ''
}

/** 取首字母：昵称优先，其次 UID；中文取第一个字，英文取首字母大写 */
const initial = computed(() => {
  const source = (props.nickname || props.publicUid || '?').trim()
  if (!source) return '?'
  const first = [...source][0]
  return first.toUpperCase()
})

/** 默认头像底色：按首字母散列到一组柔和配色，保证同一个人颜色稳定 */
const PALETTE = [
  '#409eff',
  '#67c23a',
  '#e6a23c',
  '#f56c6c',
  '#909399',
  '#9254de',
  '#13c2c2',
  '#eb6420'
]

const bgColor = computed(() => {
  const source = props.nickname || props.publicUid || '?'
  let hash = 0
  for (const ch of source) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
})

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.42)}px`
}))
</script>

<template>
  <el-avatar
    v-if="imageSrc"
    :src="imageSrc"
    :size="size"
    :shape="round ? 'circle' : 'square'"
    class="user-avatar"
    @error="handleError"
  />
  <span
    v-else
    class="user-avatar user-avatar--fallback"
    :style="{ ...sizeStyle, backgroundColor: bgColor }"
  >
    {{ initial }}
  </span>
</template>

<style scoped>
.user-avatar {
  flex-shrink: 0;
  vertical-align: middle;
}

.user-avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 500;
  line-height: 1;
  user-select: none;
}
</style>
