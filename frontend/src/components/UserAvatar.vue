<script setup lang="ts">
import { computed } from 'vue'

/**
 * 用户头像（线③ 卡 E-3）。
 *
 * 优先显示 user.avatar（走统一文件上传拿到的 URL）；
 * 没有上传头像时，用昵称首字母（或用户名首字母）生成彩色默认头像——
 * 新注册用户默认就有头像，不会出现一片空白。
 */
const props = withDefaults(
  defineProps<{
    /** 头像 URL；为空则用首字母生成默认头像 */
    src?: string
    /** 昵称，优先用于取首字母 */
    nickname?: string
    /** 用户名，昵称为空时的兜底 */
    username?: string
    /** 头像尺寸（像素） */
    size?: number
    /** 圆角：圆形头像传 true */
    round?: boolean
  }>(),
  {
    src: '',
    nickname: '',
    username: '',
    size: 40,
    round: true
  }
)

/** 取首字母：昵称优先，其次用户名；中文取第一个字，英文取首字母大写 */
const initial = computed(() => {
  const source = (props.nickname || props.username || '?').trim()
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
  const source = props.nickname || props.username || '?'
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
    v-if="src"
    :src="src"
    :size="size"
    :shape="round ? 'circle' : 'square'"
    class="user-avatar"
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
