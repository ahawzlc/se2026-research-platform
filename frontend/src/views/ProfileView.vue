<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules, UploadRequestOptions } from 'element-plus'
import { conversationsApi, fileApi, friendsApi } from '@/api'
import type { ProfileVisibility, UserProfile } from '@/api/friends'
import UserAvatar from '@/components/UserAvatar.vue'
import { useUserStore } from '@/store/user'

/**
 * 个人主页（线③ 卡 E-3）。
 *
 * 两种模式共用一个页面：
 *   - /profile          本人主页（可编辑资料、改密）；
 *   - /profile/:userId  他人主页（只读，按可见范围决定能否访问）。
 *
 * 他人主页上的操作：加好友 / 发私信 / 删除好友。
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** 路由上的用户 id；为空表示看自己的主页 */
const routeUserId = computed(() => {
  const raw = route.params.userId
  return typeof raw === 'string' ? raw : ''
})

const isSelfView = computed(() => routeUserId.value === '')

const profile = ref<UserProfile | null>(null)
const loading = ref(false)
const notFound = ref(false)

// ---------------------------------------------------------------- 资料编辑

const editVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editLoading = ref(false)
const editForm = reactive({
  nickname: '',
  bio: '',
  avatar: '',
  profileVisibility: 'public' as ProfileVisibility
})

const VISIBILITY_OPTIONS: Array<{ value: ProfileVisibility; label: string; hint: string }> = [
  { value: 'public', label: '所有人可见', hint: '任何登录用户都能查看你的主页与简介' },
  { value: 'friends', label: '仅好友可见', hint: '只有互为好友的用户能查看' },
  { value: 'private', label: '仅自己可见', hint: '除你以外谁都看不到你的主页' }
]

const editRules: FormRules = {
  nickname: [
    { required: true, message: '昵称不能为空', trigger: 'blur' },
    { max: 50, message: '昵称最长 50 个字符', trigger: 'blur' }
  ],
  bio: [{ max: 500, message: '简介最长 500 个字符', trigger: 'blur' }]
}

// ---------------------------------------------------------------- 头像上传

const uploading = ref(false)

/** 头像原始文件大小上限（MB）——评审意见 D2 */
const AVATAR_MAX_SIZE_MB = 2

/** 头像压缩后的边长（像素）——评审意见 D2 */
const AVATAR_TARGET_SIZE = 200

/**
 * 用 canvas 把头像缩放到 AVATAR_TARGET_SIZE 见方。
 *
 * 为什么要压缩（评审意见 D2）：
 *   头像走的是**通用文件上传接口**（上限 50MB），前端不压缩的话，
 *   一张手机原图能有好几 MB。而头像会在顶栏、好友列表、组队广场卡片里
 *   **反复加载**——同一张大图被不同的人反复拉一遍，浪费带宽也拖慢页面。
 *
 * @returns 压缩后的 Blob；压缩失败返回 null（调用方退回原图）
 */
async function shrinkAvatar(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_TARGET_SIZE
    canvas.height = AVATAR_TARGET_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // 居中裁剪成正方形，避免拉伸变形
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_TARGET_SIZE, AVATAR_TARGET_SIZE)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    })
    return blob
  } catch {
    return null // 浏览器不支持 createImageBitmap 等情况，退回原图
  }
}

async function handleAvatarUpload(options: UploadRequestOptions): Promise<void> {
  const raw = options.file

  // 先做大小限制，别让几十 MB 的文件进到上传接口
  if (raw.size > AVATAR_MAX_SIZE_MB * 1024 * 1024) {
    ElMessage.error(`头像不能超过 ${AVATAR_MAX_SIZE_MB}MB，请先压缩后再上传`)
    return
  }

  uploading.value = true
  try {
    // 压缩后再上传
    const blob = await shrinkAvatar(raw)
    const uploadFile = blob
      ? new File([blob], raw.name.replace(/\.\w+$/, '') + '.jpg', {
          type: 'image/jpeg'
        })
      : raw

    const item = await fileApi.uploadFile(uploadFile)
    editForm.avatar = item.url
    ElMessage.success('头像已上传，记得保存')
  } catch {
    // 提示由拦截器统一处理
  } finally {
    uploading.value = false
  }
}

// ---------------------------------------------------------------- 加载

async function loadProfile(): Promise<void> {
  loading.value = true
  notFound.value = false
  try {
    profile.value = isSelfView.value
      ? await friendsApi.fetchMyProfile()
      : await friendsApi.fetchUserProfile(routeUserId.value)
  } catch {
    // 可见范围不足或用户不存在 → 标记为不可见
    notFound.value = true
    profile.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadProfile)

/**
 * 切换查看的用户时重新加载。
 *
 * 从 /profile/1 点到 /profile/2 时，路由组件会被复用（不是重新挂载），
 * 只靠 onMounted 的话页面还停在上一个人的资料上。
 */
watch(routeUserId, loadProfile)

// ---------------------------------------------------------------- 编辑

function openEditor(): void {
  if (!profile.value) return
  editForm.nickname = profile.value.nickname
  editForm.bio = profile.value.bio
  editForm.avatar = profile.value.avatar
  editForm.profileVisibility = profile.value.profileVisibility
  editVisible.value = true
}

async function handleSave(): Promise<void> {
  if (!editFormRef.value) return
  const valid = await editFormRef.value.validate().catch(() => false)
  if (!valid) return
  editLoading.value = true
  try {
    const updated = await friendsApi.updateMyProfile({
      nickname: editForm.nickname.trim(),
      bio: editForm.bio.trim(),
      avatar: editForm.avatar,
      profileVisibility: editForm.profileVisibility
    })
    profile.value = updated
    // 同步顶栏展示（昵称/头像变了，顶栏要跟着变）
    userStore.setUserInfo({
      ...userStore.userInfo,
      nickname: updated.nickname,
      avatar: updated.avatar
    } as typeof userStore.userInfo)
    editVisible.value = false
    ElMessage.success('资料已保存')
  } catch {
    // 提示由拦截器统一处理
  } finally {
    editLoading.value = false
  }
}

// ---------------------------------------------------------------- 好友操作

const friendLoading = ref(false)

async function handleAddFriend(): Promise<void> {
  if (!profile.value?.publicUid) {
    ElMessage.warning(noUidTip)
    return
  }
  friendLoading.value = true
  try {
    await friendsApi.createFriendRequest(profile.value.publicUid)
    ElMessage.success('好友申请已发送，等待对方同意')
    await loadProfile()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    friendLoading.value = false
  }
}

async function handleRemoveFriend(): Promise<void> {
  if (!profile.value) return
  friendLoading.value = true
  try {
    await friendsApi.removeFriend(profile.value.id)
    ElMessage.success('已删除好友')
    await loadProfile()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    friendLoading.value = false
  }
}

async function handleSendMessage(): Promise<void> {
  if (!profile.value?.publicUid) {
    ElMessage.warning(noUidTip)
    return
  }
  friendLoading.value = true
  try {
    const conv = await conversationsApi.openPrivateConversationByUid(profile.value.publicUid)
    // 跳到消息页并打开该会话（会话 id 通过 query 传递）
    await router.push({ path: '/messages', query: { conversation: conv.id } })
  } catch {
    // 提示由拦截器统一处理
  } finally {
    friendLoading.value = false
  }
}

// ---------------------------------------------------------------- 关系文案

const relationText = computed(() => {
  switch (profile.value?.relation) {
    case 'friends':
      return '已是好友'
    case 'pending_sent':
      return '好友申请已发送，等待对方同意'
    case 'pending_received':
      return '对方已向你发起好友申请'
    default:
      return ''
  }
})

/** 能否给对方发私信：不能对自己发 */
const canSendMessage = computed(() => !!profile.value && !profile.value.isSelf)

/** 能否加好友：非好友且未申请过 */
const canAddFriend = computed(() => profile.value?.relation === 'none')

/**
 * 对方还没有 UID（存量用户尚未触发分配）时无法加好友 / 发私信。
 * 这两个入口都按 UID 找人，没有 UID 就只能停在这里——
 * 之前是静默返回、点了没反应也不给提示（评审意见 R1）。
 */
const peerHasUid = computed(() => !!profile.value?.publicUid)

/** 对方无 UID 时的禁用提示 */
const noUidTip = '对方还没有 UID，暂时无法加好友或发私信'

/** UID 复制 */
async function copyUid(): Promise<void> {
  if (!profile.value?.publicUid) return
  try {
    await navigator.clipboard.writeText(profile.value.publicUid)
    ElMessage.success('UID 已复制')
  } catch {
    ElMessage.info(profile.value.publicUid)
  }
}
</script>

<template>
  <div class="profile-page">
    <el-skeleton v-if="loading" :rows="6" animated />

    <el-result
      v-else-if="notFound"
      icon="warning"
      title="主页不可见"
      sub-title="该用户可能设置了「仅好友可见」或「仅自己可见」，或账号不存在"
    >
      <template #extra>
        <el-button @click="router.back()">返回</el-button>
      </template>
    </el-result>

    <template v-else-if="profile">
      <!-- 头部卡片 -->
      <el-card class="profile-header" shadow="never">
        <div class="profile-header__top">
          <UserAvatar
            :src="profile.avatar"
            :nickname="profile.nickname"
            :public-uid="profile.publicUid"
            :size="88"
          />
          <div class="profile-header__info">
            <div class="profile-header__name">
              <span class="profile-header__nickname">
                {{ profile.nickname || profile.publicUid }}
              </span>
              <el-tag v-if="profile.isSelf" size="small" type="info">这是你</el-tag>
            </div>
            <div class="profile-header__uid">
              <span class="profile-header__uid-label">UID</span>
              <code class="profile-header__uid-value">{{ profile.publicUid || '未分配' }}</code>
              <el-button v-if="profile.publicUid" link type="primary" size="small" @click="copyUid">
                复制
              </el-button>
            </div>
            <div class="profile-header__meta">加入于 {{ profile.createdAt }}</div>
          </div>
        </div>

        <p v-if="profile.bio" class="profile-header__bio">{{ profile.bio }}</p>
        <p v-else class="profile-header__bio profile-header__bio--empty">
          {{ profile.isSelf ? '还没有填写简介' : '该用户还没有填写简介' }}
        </p>

        <div class="profile-header__actions">
          <template v-if="profile.isSelf">
            <el-button type="primary" @click="openEditor">编辑资料</el-button>
            <el-button @click="router.push('/profile/settings')">账号与安全</el-button>
          </template>
          <template v-else>
            <el-tooltip :content="noUidTip" :disabled="peerHasUid" placement="top">
              <span>
                <el-button
                  v-if="canAddFriend"
                  type="primary"
                  :loading="friendLoading"
                  :disabled="!peerHasUid"
                  @click="handleAddFriend"
                >
                  加好友
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              v-if="profile.relation === 'friends'"
              :loading="friendLoading"
              @click="handleRemoveFriend"
            >
              删除好友
            </el-button>
            <el-tooltip :content="noUidTip" :disabled="peerHasUid" placement="top">
              <span>
                <el-button
                  v-if="canSendMessage"
                  type="primary"
                  plain
                  :loading="friendLoading"
                  :disabled="!peerHasUid"
                  @click="handleSendMessage"
                >
                  发私信
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </div>

        <el-alert
          v-if="relationText && !profile.isSelf"
          class="profile-header__relation"
          :title="relationText"
          type="info"
          :closable="false"
          show-icon
        />
      </el-card>

      <!-- 编辑资料弹窗 -->
      <el-dialog v-model="editVisible" title="编辑资料" width="520px">
        <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="80px">
          <el-form-item label="头像">
            <div class="avatar-editor">
              <UserAvatar
                :src="editForm.avatar"
                :nickname="editForm.nickname"
                :public-uid="profile.publicUid"
                :size="64"
              />
              <div class="avatar-editor__actions">
                <el-upload
                  :show-file-list="false"
                  :http-request="handleAvatarUpload"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                >
                  <el-button :loading="uploading">上传图片</el-button>
                </el-upload>
                <el-button v-if="editForm.avatar" link type="danger" @click="editForm.avatar = ''">
                  恢复默认头像
                </el-button>
              </div>
            </div>
          </el-form-item>

          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="editForm.nickname" maxlength="50" placeholder="1-50 个字符" />
          </el-form-item>

          <el-form-item label="简介" prop="bio">
            <el-input
              v-model="editForm.bio"
              type="textarea"
              :rows="4"
              maxlength="500"
              show-word-limit
              placeholder="介绍一下你自己吧"
            />
          </el-form-item>

          <el-form-item label="可见范围">
            <el-radio-group v-model="editForm.profileVisibility">
              <el-radio v-for="opt in VISIBILITY_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </el-radio>
            </el-radio-group>
            <div class="visibility-hint">
              {{ VISIBILITY_OPTIONS.find((o) => o.value === editForm.profileVisibility)?.hint }}
            </div>
          </el-form-item>

          <el-form-item label="UID">
            <span class="fixed-value">{{ profile.publicUid || '未分配' }}</span>
            <div class="visibility-hint">UID 创建后不可修改，用于被他人搜索与添加</div>
          </el-form-item>

          <el-form-item label="用户名">
            <!-- 登录名只有看自己时后端才返回（评审意见 C2②） -->
            <span class="fixed-value">{{ profile.username ?? '—' }}</span>
          </el-form-item>
        </el-form>

        <template #footer>
          <el-button @click="editVisible = false">取消</el-button>
          <el-button type="primary" :loading="editLoading" @click="handleSave">保存</el-button>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 760px;
  margin: 0 auto;
}

.profile-header__top {
  display: flex;
  gap: 20px;
  align-items: center;
}

.profile-header__info {
  flex: 1;
  min-width: 0;
}

.profile-header__name {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.profile-header__nickname {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.profile-header__uid {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.profile-header__uid-label {
  font-size: 12px;
  color: #909399;
}

.profile-header__uid-value {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  color: #409eff;
  background: #ecf5ff;
  padding: 1px 6px;
  border-radius: 4px;
}

.profile-header__meta {
  font-size: 12px;
  color: #909399;
}

.profile-header__bio {
  margin: 16px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: #606266;
  white-space: pre-wrap;
  word-break: break-word;
}

.profile-header__bio--empty {
  color: #c0c4cc;
  font-style: italic;
}

.profile-header__actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.profile-header__relation {
  margin-top: 16px;
}

.avatar-editor {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-editor__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.visibility-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.fixed-value {
  color: #909399;
}
</style>
