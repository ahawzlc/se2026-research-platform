<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi } from '@/api'
import type { ApplicationStatus, CommunityPostItem, PostStatus } from '@/api/community'
import { displayNickname } from '@/utils/display'
import PostFormDialog from '@/components/community/PostFormDialog.vue'
import ApplicationsPanel from '@/components/community/ApplicationsPanel.vue'

/**
 * 招募帖详情（卡 E-1 / E-2，线②）：全站登录用户可见。
 * 发帖人在此管理帖子（编辑 / 停止招募 / 删除）并处理申请；其他人可以「申请加入」与「私信 TA」。
 */

/** 状态中文名与标签配色（与广场页同一口径） */
const STATUS_META: Record<PostStatus, { label: string; tag: 'success' | 'warning' | 'info' }> = {
  recruiting: { label: '招募中', tag: 'success' },
  full: { label: '已满员', tag: 'warning' },
  closed: { label: '已停止', tag: 'info' }
}

/** 申请状态文案：按钮置灰时说明当前进度 */
const MY_APPLICATION_LABELS: Record<ApplicationStatus, string> = {
  pending: '已申请 · 待处理',
  approved: '已通过 · 已入组',
  rejected: '已被拒绝'
}

/** 发帖人可见的页签；页签随 URL 保存，铃铛的「有人申请」通知可直达申请管理 */
type PageTab = 'detail' | 'applications'
const APPLICATIONS_TAB = 'applications'

const route = useRoute()
const router = useRouter()

const post = ref<CommunityPostItem | null>(null)
const loading = ref(false)
const notFound = ref(false)
const activeTab = ref<PageTab>(route.query.tab === APPLICATIONS_TAB ? APPLICATIONS_TAB : 'detail')

const postId = computed(() => String(route.params.id ?? ''))
const percent = computed(() => {
  if (!post.value || post.value.recruitTotal <= 0) return 0
  return Math.round((post.value.recruitedCount / post.value.recruitTotal) * 100)
})

/** 只有「招募中、且我还没申请过」的他人帖子可以申请 */
const canApply = computed(
  () =>
    post.value !== null && post.value.status === 'recruiting' && post.value.myApplication === null
)

/** 「申请加入」按钮文案：已有申请看申请状态，否则看帖子状态 */
const joinLabel = computed(() => {
  const current = post.value
  if (!current) return ''
  const mine = current.myApplication
  if (mine) return MY_APPLICATION_LABELS[mine.status]
  if (current.status === 'full') return '已满员'
  if (current.status === 'closed') return '已停止招募'
  return '申请加入'
})

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false
  try {
    post.value = await communityApi.fetchCommunityPost(postId.value)
    // 申请管理只对发帖人开放：带 tab 参数打开他人帖子时回到详情
    if (!post.value.isAuthor && activeTab.value === APPLICATIONS_TAB) {
      syncTab('detail')
    }
  } catch {
    // 提示由拦截器统一处理；帖子不存在或已删除时展示返回入口
    post.value = null
    notFound.value = true
  } finally {
    loading.value = false
  }
}

// 同一页面内切到另一篇帖子（如从通知跳转）时重新加载
watch(postId, () => {
  void load()
})

/** 切换页签并把当前页签写回 URL；回到详情时清掉参数，默认状态就是干净的详情地址 */
function syncTab(name: string | number): void {
  activeTab.value = name === APPLICATIONS_TAB ? APPLICATIONS_TAB : 'detail'
  void router.replace({
    query: activeTab.value === APPLICATIONS_TAB ? { tab: APPLICATIONS_TAB } : {}
  })
}

function backToSquare(): void {
  // 从广场进入时原路返回可保留筛选；直接打开详情（新标签页）则回到广场
  if (window.history.state?.back) {
    router.back()
  } else {
    void router.push('/community')
  }
}

/** 「私信 TA」：跳消息页并带上对方 id，由消息页打开（或新建）与对方的私信会话（线③ E-3 入口） */
function chatWithAuthor(): void {
  if (!post.value) return
  void router.push({ path: '/messages', query: { peer: post.value.author.id } })
}

// ---------------------------------------------------------------- 发帖人：编辑 / 停止 / 删除

const editVisible = ref(false)

function handleSaved(saved: CommunityPostItem): void {
  post.value = saved
  ElMessage.success('已保存')
}

async function handleClose(): Promise<void> {
  if (!post.value) return
  const confirmed = await ElMessageBox.confirm(
    '停止后不能再接收新申请，且无法恢复；已有的申请仍可处理。确定停止招募？',
    '停止招募',
    { type: 'warning', confirmButtonText: '停止招募', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  try {
    post.value = await communityApi.closeCommunityPost(post.value.id)
    ElMessage.success('已停止招募')
  } catch {
    // 提示由拦截器统一处理
  }
}

async function handleRemove(): Promise<void> {
  if (!post.value) return
  const confirmed = await ElMessageBox.confirm(
    '删除后广场与详情立即不可见；已组建的课题组不受影响。确定删除这篇帖子？',
    '删除帖子',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  try {
    await communityApi.deleteCommunityPost(post.value.id)
    ElMessage.success('帖子已删除')
    void router.replace('/community')
  } catch {
    // 提示由拦截器统一处理（还有待处理申请时后端返回 409 并说明条数）
  }
}

// ---------------------------------------------------------------- 其他人：申请加入

const applyVisible = ref(false)
const applyNote = ref('')
const applying = ref(false)

function openApply(): void {
  applyNote.value = ''
  applyVisible.value = true
}

async function handleApply(): Promise<void> {
  if (!post.value) return
  applying.value = true
  try {
    await communityApi.applyCommunityPost(post.value.id, {
      note: applyNote.value.trim() || undefined
    })
    applyVisible.value = false
    ElMessage.success('申请已提交，发帖人处理后会通过铃铛通知你')
    await load()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="post-page">
    <el-button link class="back-link" @click="backToSquare">← 返回广场</el-button>

    <el-card v-if="notFound" shadow="never">
      <el-empty description="帖子不存在或已被删除" :image-size="80">
        <el-button @click="backToSquare">返回广场</el-button>
      </el-empty>
    </el-card>

    <template v-else>
      <!-- 发帖人：招募详情 / 申请管理 两个页签 -->
      <!-- 上下内边距为 0：页签头自身比外层高 1px，靠它默认的下外边距吸收（清掉会多出滚动条） -->
      <el-card
        v-if="post?.isAuthor"
        shadow="never"
        class="tabs-card"
        :body-style="{ padding: '0 20px' }"
      >
        <el-tabs v-model="activeTab" @tab-change="syncTab">
          <el-tab-pane label="招募详情" name="detail" />
          <el-tab-pane name="applications">
            <template #label>
              <span>申请管理</span>
              <span v-if="post.pendingCount > 0" class="tab-badge">{{ post.pendingCount }}</span>
            </template>
          </el-tab-pane>
        </el-tabs>
      </el-card>

      <div v-show="activeTab === 'detail'" v-loading="loading" class="post-layout">
        <el-card v-if="post" shadow="never" class="post-main">
          <div class="post-head">
            <div class="post-heading">
              <h2 class="post-title">{{ post.title }}</h2>
              <el-tag :type="STATUS_META[post.status].tag" effect="light">
                {{ STATUS_META[post.status].label }}
              </el-tag>
            </div>
            <el-tag v-if="post.isAuthor" type="info" effect="plain">我发布的</el-tag>
          </div>

          <div class="post-progress">
            <span class="progress-text">
              已招 {{ post.recruitedCount }} / {{ post.recruitTotal }} 人
            </span>
            <el-progress
              :percentage="percent"
              :status="post.status === 'full' ? 'success' : undefined"
              :stroke-width="8"
            />
          </div>

          <div v-if="post.tags.length > 0" class="post-tags">
            <el-tag
              v-for="tag in post.tags"
              :key="tag.id"
              :type="tag.category === 'competition' ? 'danger' : 'primary'"
              size="small"
              effect="plain"
            >
              {{ tag.name }}
            </el-tag>
          </div>

          <div class="post-content">{{ post.content || '（发布人暂未填写项目说明）' }}</div>

          <div class="post-foot">
            <span>发布于 {{ post.createdAt }}</span>
            <span v-if="post.team" class="foot-team">已组建课题组：{{ post.team.name }}</span>
          </div>
        </el-card>

        <aside v-if="post" class="post-aside">
          <el-card shadow="never" class="author-card">
            <div class="author-line">
              <el-avatar :size="40" :src="post.author.avatar">
                {{ displayNickname(post.author.nickname).charAt(0) }}
              </el-avatar>
              <div class="author-meta">
                <span class="author-name">{{ displayNickname(post.author.nickname) }}</span>
                <span class="author-role">发布人</span>
              </div>
            </div>
            <el-button class="chat-button" :disabled="post.isAuthor" @click="chatWithAuthor">
              私信 TA
            </el-button>
          </el-card>

          <el-card shadow="never" class="manage-card">
            <template #header>
              <span class="card-title">{{ post.isAuthor ? '管理帖子' : '加入团队' }}</span>
            </template>
            <!-- 发帖人：编辑（仅招募中）/ 停止招募 / 删除 -->
            <div v-if="post.isAuthor" class="author-actions">
              <el-button
                type="primary"
                :disabled="post.status !== 'recruiting'"
                @click="editVisible = true"
              >
                编辑
              </el-button>
              <el-button :disabled="post.status === 'closed'" @click="handleClose">
                停止招募
              </el-button>
              <el-button type="danger" plain @click="handleRemove">删除</el-button>
            </div>
            <!-- 其他人：申请加入；已申请 / 已满员 / 已停止时置灰并说明原因 -->
            <template v-else>
              <el-button
                type="primary"
                size="large"
                class="join-button"
                :disabled="!canApply"
                @click="openApply"
              >
                {{ joinLabel }}
              </el-button>
              <p v-if="post.myApplication?.status === 'approved'" class="join-hint">
                你已加入课题组「{{ post.team?.name }}」，可在「课题组成员」中查看
              </p>
            </template>
          </el-card>
        </aside>
      </div>

      <!-- 申请管理：处理后会改变帖子进度与待处理数，组件通过 changed 通知本页重新拉取 -->
      <ApplicationsPanel
        v-if="post?.isAuthor && activeTab === 'applications'"
        :post="post"
        @changed="load"
      />
    </template>

    <PostFormDialog v-model="editVisible" :post="post" @saved="handleSaved" />

    <!-- 申请加入 -->
    <el-dialog v-model="applyVisible" title="申请加入" width="480px" :close-on-click-modal="false">
      <p v-if="post" class="apply-hint">
        向
        <b>{{ displayNickname(post.author.nickname) }}</b>
        说明你能贡献什么，发帖人会在「申请管理」里处理。
      </p>
      <el-input
        v-model="applyNote"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="如：我会前端，做过两个 Vue 项目（可不填）"
      />
      <template #footer>
        <el-button @click="applyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applying" @click="handleApply">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.post-page {
  max-width: 1080px;
}

.back-link {
  margin-bottom: 10px;
  padding-left: 0;
  color: #606266;
}

.tabs-card {
  margin-bottom: 14px;
}

.tab-badge {
  display: inline-block;
  min-width: 18px;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  color: #ffffff;
  background: var(--el-color-danger);
  border-radius: 9px;
}

.post-layout {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.post-main {
  flex: 1;
  min-width: 0;
}

.post-aside {
  width: 280px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.post-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.post-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.post-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  color: #303133;
  overflow-wrap: anywhere;
}

.post-progress {
  margin: 14px 0 16px;
}

.progress-text {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}

.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.post-content {
  padding: 14px 0 18px;
  border-top: 1px solid var(--app-border);
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.post-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border);
  font-size: 12px;
  color: #909399;
}

.author-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.author-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.author-name {
  font-size: 15px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-role {
  font-size: 12px;
  color: #909399;
}

.chat-button {
  width: 100%;
  margin-top: 14px;
}

.card-title {
  font-weight: 600;
  color: #303133;
}

.author-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.author-actions .el-button {
  margin-left: 0;
}

.join-button {
  width: 100%;
}

.join-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}

.apply-hint {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.7;
  color: #606266;
}

@media (max-width: 860px) {
  .post-layout {
    flex-direction: column;
  }

  .post-aside {
    width: 100%;
  }
}
</style>
