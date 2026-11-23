<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { conversationsApi, friendsApi } from '@/api'
import type { FriendItem, FriendRequestItem } from '@/api/friends'
import UserAvatar from '@/components/UserAvatar.vue'
import { useUserStore } from '@/store/user'

/**
 * 好友页（线③ 卡 E-3）。
 *
 * 三个页签：
 *   - 好友：已互为好友的用户卡片，可发私信 / 删除好友；
 *   - 收到的申请：对方申请我，可同意 / 拒绝；
 *   - 发出的申请：我申请对方（等待处理）。
 *
 * 「通过 UID 添加好友」在页签顶部，输入对方 UID 即可发起申请。
 */
const router = useRouter()
const userStore = useUserStore()

const activeTab = ref('friends')

const friends = ref<FriendItem[]>([])
const incoming = ref<FriendRequestItem[]>([])
const outgoing = ref<FriendRequestItem[]>([])
const loading = ref(false)

// ---------------------------------------------------------------- 加好友

const addUid = ref('')
const adding = ref(false)

async function handleAddFriend(): Promise<void> {
  const uid = addUid.value.trim()
  if (!uid) {
    ElMessage.warning('请输入对方的 UID')
    return
  }
  adding.value = true
  try {
    await friendsApi.createFriendRequest(uid)
    ElMessage.success('好友申请已发送')
    addUid.value = ''
    await loadRequests()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    adding.value = false
  }
}

// ---------------------------------------------------------------- 申请处理

const actionLoading = ref('')

async function handleAccept(item: FriendRequestItem): Promise<void> {
  actionLoading.value = item.requestId
  try {
    await friendsApi.acceptFriendRequest(item.requestId)
    ElMessage.success(`已与 ${item.nickname || item.username} 成为好友`)
    await loadAll()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    actionLoading.value = ''
  }
}

async function handleReject(item: FriendRequestItem): Promise<void> {
  actionLoading.value = item.requestId
  try {
    await friendsApi.rejectFriendRequest(item.requestId)
    ElMessage.success('已拒绝该申请')
    await loadRequests()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    actionLoading.value = ''
  }
}

// ---------------------------------------------------------------- 好友操作

async function handleRemove(item: FriendItem): Promise<void> {
  actionLoading.value = item.id
  try {
    await friendsApi.removeFriend(item.id)
    ElMessage.success('已删除好友')
    await loadFriends()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    actionLoading.value = ''
  }
}

async function handleChat(item: FriendItem): Promise<void> {
  actionLoading.value = item.id
  try {
    const conv = await conversationsApi.openPrivateConversationByUid(item.publicUid)
    await router.push({ path: '/messages', query: { conversation: conv.id } })
  } catch {
    // 提示由拦截器统一处理
  } finally {
    actionLoading.value = ''
  }
}

function openProfile(item: { id: string }): void {
  void router.push({ path: `/profile/${item.id}` })
}

// ---------------------------------------------------------------- 加载

async function loadFriends(): Promise<void> {
  const result = await friendsApi.fetchFriends()
  friends.value = result.list
}

async function loadRequests(): Promise<void> {
  const result = await friendsApi.fetchFriendRequests()
  incoming.value = result.incoming
  outgoing.value = result.outgoing
}

async function loadAll(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadFriends(), loadRequests()])
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)

/** 待处理申请数（给页签角标） */
const pendingCount = computed(() => incoming.value.length)
</script>

<template>
  <div class="friends-page">
    <el-card class="friends-add" shadow="never">
      <div class="friends-add__row">
        <el-input
          v-model="addUid"
          placeholder="输入对方 UID（如 U0000000123）添加好友"
          clearable
          @keyup.enter="handleAddFriend"
        >
          <template #prepend>UID</template>
        </el-input>
        <el-button type="primary" :loading="adding" @click="handleAddFriend">
          加好友
        </el-button>
      </div>
      <div class="friends-add__hint">
        UID 在对方的个人主页上可以看到。我的 UID：
        <code>{{ userStore.userInfo?.publicUid || '未分配' }}</code>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" class="friends-tabs">
      <el-tab-pane label="好友" name="friends">
        <el-skeleton v-if="loading" :rows="3" animated />
        <el-empty v-else-if="friends.length === 0" description="还没有好友，去加一个吧" />
        <div v-else class="friend-grid">
          <div v-for="item in friends" :key="item.id" class="friend-card">
            <div class="friend-card__head" @click="openProfile(item)">
              <UserAvatar
                :src="item.avatar"
                :nickname="item.nickname"
                :username="item.username"
                :size="48"
              />
              <div class="friend-card__name">
                <div class="friend-card__nickname">{{ item.nickname || item.username }}</div>
                <div class="friend-card__uid">{{ item.publicUid }}</div>
              </div>
            </div>
            <p v-if="item.bio" class="friend-card__bio">{{ item.bio }}</p>
            <div class="friend-card__actions">
              <el-button
                type="primary"
                size="small"
                :loading="actionLoading === item.id"
                @click="handleChat(item)"
              >
                发私信
              </el-button>
              <el-button
                size="small"
                :loading="actionLoading === item.id"
                @click="handleRemove(item)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="requests">
        <template #label>
          <span>收到的申请</span>
          <el-badge v-if="pendingCount > 0" :value="pendingCount" class="tab-badge" />
        </template>
        <el-empty v-if="incoming.length === 0" description="没有待处理的申请" />
        <div v-else class="request-list">
          <div v-for="item in incoming" :key="item.requestId" class="request-card">
            <div class="request-card__head" @click="openProfile(item)">
              <UserAvatar
                :src="item.avatar"
                :nickname="item.nickname"
                :username="item.username"
                :size="44"
              />
              <div class="request-card__name">
                <div class="request-card__nickname">{{ item.nickname || item.username }}</div>
                <div class="request-card__time">{{ item.createdAt }}</div>
              </div>
            </div>
            <div class="request-card__actions">
              <el-button
                type="primary"
                size="small"
                :loading="actionLoading === item.requestId"
                @click="handleAccept(item)"
              >
                同意
              </el-button>
              <el-button
                size="small"
                :loading="actionLoading === item.requestId"
                @click="handleReject(item)"
              >
                拒绝
              </el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="发出的申请" name="outgoing">
        <el-empty v-if="outgoing.length === 0" description="没有待处理的申请" />
        <div v-else class="request-list">
          <div v-for="item in outgoing" :key="item.requestId" class="request-card">
            <div class="request-card__head" @click="openProfile(item)">
              <UserAvatar
                :src="item.avatar"
                :nickname="item.nickname"
                :username="item.username"
                :size="44"
              />
              <div class="request-card__name">
                <div class="request-card__nickname">{{ item.nickname || item.username }}</div>
                <div class="request-card__time">{{ item.createdAt }} · 等待对方处理</div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.friends-page {
  max-width: 860px;
  margin: 0 auto;
}

.friends-add {
  margin-bottom: 12px;
}

.friends-add__row {
  display: flex;
  gap: 10px;
}

.friends-add__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.friends-add__hint code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  color: #409eff;
}

.friends-tabs {
  background: #fff;
  padding: 0 16px 16px;
  border-radius: 8px;
}

.tab-badge {
  margin-left: 6px;
}

.friend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.friend-card {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 14px;
}

.friend-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.friend-card__name {
  min-width: 0;
}

.friend-card__nickname {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friend-card__uid {
  font-size: 12px;
  color: #909399;
  font-family: 'SFMono-Regular', Consolas, monospace;
}

.friend-card__bio {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.friend-card__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

.request-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.request-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px 14px;
}

.request-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  min-width: 0;
}

.request-card__nickname {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.request-card__time {
  font-size: 12px;
  color: #909399;
}

.request-card__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
