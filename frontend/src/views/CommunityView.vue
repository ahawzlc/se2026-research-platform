<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { communityApi } from '@/api'
import type { CommunityPostItem, CommunityTag, PostStatus, TagCategory } from '@/api/community'
import PostFormDialog from '@/components/community/PostFormDialog.vue'

/**
 * 组队广场（卡 E-1，线②）：卡片流浏览 + 标签/关键词/状态筛选 + 发布招募。
 * 筛选条件随 URL 保存，从帖子详情返回时筛选不丢。
 */

/** 状态中文名与标签配色（枚举与后端 POST_STATUSES 对齐，不得自造） */
const STATUS_META: Record<PostStatus, { label: string; tag: 'success' | 'warning' | 'info' }> = {
  recruiting: { label: '招募中', tag: 'success' },
  full: { label: '已满员', tag: 'warning' },
  closed: { label: '已停止', tag: 'info' }
}

/** 标签类别中文名，用于筛选项分组 */
const CATEGORY_LABELS: Record<TagCategory, string> = {
  competition: '竞赛',
  course: '课程'
}

/** 卡片摘要长度（完整说明在详情页） */
const EXCERPT_LENGTH = 80

const route = useRoute()
const router = useRouter()

const list = ref<CommunityPostItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(12)
const loading = ref(false)

const filters = reactive({
  tags: [] as string[],
  q: '',
  status: '' as '' | PostStatus,
  mine: false
})

const hasFilters = computed(
  () => filters.tags.length > 0 || filters.q.trim() !== '' || filters.status !== '' || filters.mine
)

/** 空状态文案：区分「广场还没内容」「筛选无结果」「我没发过」三种情况 */
const onlyMine = computed(
  () =>
    filters.mine && filters.tags.length === 0 && filters.q.trim() === '' && filters.status === ''
)
const emptyText = computed(() => {
  if (!hasFilters.value) return '还没有招募帖'
  return onlyMine.value ? '你还没有发布过招募帖' : '没有符合条件的招募帖'
})

const tags = ref<CommunityTag[]>([])
const groupedTags = computed(() =>
  (Object.keys(CATEGORY_LABELS) as TagCategory[]).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    tags: tags.value.filter((tag) => tag.category === category)
  }))
)

async function loadTags(): Promise<void> {
  try {
    tags.value = await communityApi.fetchCommunityTags()
  } catch {
    // 提示由拦截器统一处理
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await communityApi.fetchCommunityPosts({
      page: page.value,
      size: size.value,
      tags: filters.tags.join(',') || undefined,
      q: filters.q.trim() || undefined,
      status: filters.status || undefined,
      mine: filters.mine || undefined
    })
    list.value = result.list
    total.value = result.total
  } catch {
    // 提示由拦截器统一处理
  } finally {
    loading.value = false
  }
}

/** 把筛选条件写回 URL；只保留有值的项，默认状态就是干净的 /community */
function syncQuery(): void {
  void router.replace({
    query: {
      ...(filters.tags.length > 0 ? { tags: filters.tags.join(',') } : {}),
      ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.mine ? { mine: 'true' } : {})
    }
  })
}

function isPostStatus(value: unknown): value is PostStatus {
  return value === 'recruiting' || value === 'full' || value === 'closed'
}

/** 从 URL 还原筛选条件（详情页返回、或带参进入时生效） */
function readQuery(): void {
  const query = route.query
  filters.tags = typeof query.tags === 'string' ? query.tags.split(',').filter(Boolean) : []
  filters.q = typeof query.q === 'string' ? query.q : ''
  filters.status = isPostStatus(query.status) ? query.status : ''
  filters.mine = query.mine === 'true'
}

function applyFilters(): void {
  page.value = 1
  syncQuery()
  void load()
}

function resetFilters(): void {
  filters.tags = []
  filters.q = ''
  filters.status = ''
  filters.mine = false
  applyFilters()
}

function handlePageChange(next: number): void {
  page.value = next
  void load()
}

function openPost(post: CommunityPostItem): void {
  void router.push(`/community/${post.id}`)
}

/** 发布成功后直接进入新帖详情 */
function handleSaved(post: CommunityPostItem): void {
  openPost(post)
}

function excerpt(post: CommunityPostItem): string {
  const text = post.content.replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}

const publishVisible = ref(false)

onMounted(() => {
  readQuery()
  void loadTags()
  void load()
})
</script>

<template>
  <div class="community-page">
    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <el-select
            v-model="filters.tags"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="按标签筛选"
            class="filter-tags"
            @change="applyFilters"
          >
            <el-option-group
              v-for="group in groupedTags"
              :key="group.category"
              :label="group.label"
            >
              <el-option
                v-for="tag in group.tags"
                :key="tag.id"
                :label="tag.name"
                :value="tag.id"
              />
            </el-option-group>
          </el-select>
          <el-input
            v-model="filters.q"
            placeholder="搜索标题或正文"
            clearable
            class="filter-q"
            @keyup.enter="applyFilters"
            @clear="applyFilters"
          />
          <el-select
            v-model="filters.status"
            placeholder="全部状态"
            clearable
            class="filter-status"
            @change="applyFilters"
          >
            <el-option
              v-for="(meta, key) in STATUS_META"
              :key="key"
              :label="meta.label"
              :value="key"
            />
          </el-select>
          <el-checkbox v-model="filters.mine" @change="applyFilters">只看我的发布</el-checkbox>
          <el-button v-if="hasFilters" link @click="resetFilters">重置</el-button>
          <div class="toolbar-actions">
            <el-button type="primary" @click="publishVisible = true">发布招募</el-button>
          </div>
        </div>
      </template>

      <div v-loading="loading" class="post-grid">
        <el-empty v-if="list.length === 0 && !loading" :description="emptyText" :image-size="80">
          <el-button v-if="!hasFilters" type="primary" @click="publishVisible = true">
            发布第一个招募
          </el-button>
          <el-button v-else @click="resetFilters">清除筛选</el-button>
        </el-empty>

        <article
          v-for="post in list"
          :key="post.id"
          class="post-card"
          tabindex="0"
          @click="openPost(post)"
          @keydown.enter="openPost(post)"
        >
          <div class="post-card-head">
            <el-tag :type="STATUS_META[post.status].tag" size="small" effect="light">
              {{ STATUS_META[post.status].label }}
            </el-tag>
            <span class="post-progress">
              已招 {{ post.recruitedCount }}/{{ post.recruitTotal }}
            </span>
          </div>
          <h3 class="post-title">{{ post.title }}</h3>
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
          <p v-if="post.content" class="post-excerpt">{{ excerpt(post) }}</p>
          <div class="post-card-foot">
            <el-avatar :size="22" :src="post.author.avatar">
              {{ post.author.nickname.charAt(0) }}
            </el-avatar>
            <span class="post-author">{{ post.author.nickname }}</span>
            <span class="post-time">{{ post.createdAt }}</span>
          </div>
        </article>
      </div>

      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="page"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <PostFormDialog v-model="publishVisible" @saved="handleSaved" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-tags {
  width: 260px;
}

.filter-q {
  width: 200px;
}

.filter-status {
  width: 120px;
}

.toolbar-actions {
  margin-left: auto;
}

.post-grid {
  min-height: 240px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.post-card {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  cursor: pointer;
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}

.post-card:hover,
.post-card:focus-visible {
  border-color: var(--el-color-primary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  outline: none;
}

.post-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.post-progress {
  font-size: 12px;
  color: #909399;
}

.post-title {
  margin: 8px 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.post-excerpt {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-card-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  font-size: 12px;
  color: #606266;
}

.post-time {
  margin-left: auto;
  color: #909399;
}

.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
</style>
