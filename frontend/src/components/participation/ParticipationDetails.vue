<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  fetchParticipationDetails,
  type ParticipationEvent,
  type ParticipationSummary
} from '@/api/stats'
import type { PageResult } from '@/api/types'

const props = defineProps<{
  teamId: string
  filter: { userId?: string; dimension?: string; weekStart?: string }
  weeks: ParticipationSummary['weekly']
  dimensions: ParticipationSummary['dimensions']
  members: ParticipationSummary['members']
}>()
const open = defineModel<boolean>({ required: true })
const dimension = ref('')
const weekStart = ref('')
const page = ref(1)
const retry = ref(0)
const loading = ref(false)
const failed = ref(false)
const result = ref<PageResult<ParticipationEvent> | null>(null)
const pageSize = 10
const userId = computed(() => props.filter.userId)

const types: Record<string, string> = {
  task_create: '创建任务',
  task_done: '完成任务',
  achievement_submit: '提交成果',
  milestone_done: '完成里程碑',
  meeting_create: '创建会议',
  meeting_attend: '参加会议',
  literature_upload: '登记文献',
  literature_read: '阅读文献',
  comment_create: '发表评论'
}
const reasons: Record<string, string> = {
  counted: '已计入',
  unknown_type: '未知行为',
  invalid_ref: '关联对象无效',
  revoked: '业务已撤销',
  duplicate: '重复行为',
  inactive_task: '任务当前未完成或已删除',
  invalid_comment: '评论已失效',
  daily_limit: '超出当日计入上限'
}
const names = computed(
  () => new Map(props.members.map((member) => [member.userId, member.nickname]))
)
const title = computed(() =>
  userId.value ? `${names.value.get(userId.value) ?? userId.value} · 行为明细` : '行为明细'
)
const dimensionSummary = computed(() => {
  if (!userId.value || weekStart.value) return null
  const metric = props.dimensions.find((item) => item.key === dimension.value)
  const member = props.members.find((item) => item.userId === userId.value)
  const value = member?.dimensions.find((item) => item.key === dimension.value)
  return metric && member?.hasData && value
    ? { max: metric.max, raw: value.raw, normalized: value.normalized }
    : null
})
const rows = computed(
  () =>
    result.value?.list.map((event) => ({
      ...event,
      member: names.value.get(event.userId) ?? `成员 #${event.userId}`,
      label: types[event.type] ?? event.type,
      ref: event.source?.title ?? (event.refId ? `记录 #${event.refId}` : '—'),
      route: sourceRoute(event),
      explanation: reasons[event.reason] ?? '未计入'
    })) ?? []
)

function sourceRoute(event: ParticipationEvent) {
  const source = event.source
  if (!source?.projectId) return
  if (source.kind === 'task')
    return {
      name: 'tasks',
      query: {
        projectId: source.projectId,
        taskId: source.id,
        ...(event.refType === 'message' ? { comments: '1' } : {})
      }
    }
  if (source.kind === 'milestone')
    return {
      name: 'projects',
      query: { projectId: source.projectId, milestoneId: source.id }
    }
}

watch([open, () => props.teamId, () => props.filter], () => {
  dimension.value = props.filter.dimension ?? ''
  weekStart.value = props.filter.weekStart ?? ''
  page.value = 1
})
watch([dimension, weekStart], () => {
  page.value = 1
})

watch(
  [open, () => props.teamId, userId, dimension, weekStart, page, retry],
  async ([visible, teamId, member, selectedDimension, week, currentPage], _previous, onCleanup) => {
    const request = new window.AbortController()
    onCleanup(() => request.abort())
    failed.value = false
    loading.value = visible
    if (!visible) {
      result.value = null
      return
    }
    try {
      const data = await fetchParticipationDetails(
        {
          teamId,
          userId: member,
          dimension: selectedDimension || undefined,
          weekStart: week || undefined,
          page: currentPage,
          size: pageSize
        },
        request.signal
      )
      if (!request.signal.aborted) {
        if (currentPage > 1 && data.list.length === 0) {
          page.value = Math.max(1, Math.ceil(data.total / pageSize))
        } else {
          result.value = data
        }
      }
    } catch {
      if (!request.signal.aborted) failed.value = true
    } finally {
      if (!request.signal.aborted) loading.value = false
    }
  }
)
</script>

<template>
  <el-drawer v-model="open" :title="title" size="min(880px, 100vw)" destroy-on-close>
    <div class="detail-toolbar">
      <el-select
        v-model="dimension"
        aria-label="按维度筛选"
        placeholder="全部维度"
        style="width: 200px"
      >
        <el-option label="全部维度" value="" />
        <el-option
          v-for="item in dimensions"
          :key="item.key"
          :label="item.label"
          :value="item.key"
        />
      </el-select>
      <el-select
        v-model="weekStart"
        aria-label="按活跃周筛选"
        placeholder="全部活跃周"
        style="width: 175px"
      >
        <el-option label="全部活跃周" value="" />
        <el-option
          v-for="week in weeks"
          :key="week.weekStart"
          :label="week.weekStart + ' 当周'"
          :value="week.weekStart"
        />
      </el-select>
      <span class="detail-hint">北京时间 · 最新记录在前</span>
    </div>

    <div v-if="dimensionSummary" class="dimension-context">
      <span>
        本维度计入值
        <strong>{{ dimensionSummary.raw }}</strong>
      </span>
      <span>
        组内最大值
        <strong>{{ dimensionSummary.max }}</strong>
      </span>
      <span>
        归一化
        <strong>{{ (dimensionSummary.normalized * 100).toFixed(1) }}</strong>
        / 100
      </span>
    </div>

    <el-result v-if="failed" icon="error" title="行为明细加载失败">
      <template #extra><el-button @click="retry++">重试</el-button></template>
    </el-result>
    <div v-else v-loading="loading" class="detail-results">
      <el-table :data="rows" empty-text="没有符合条件的行为记录" row-key="id">
        <el-table-column prop="createdAt" label="发生时间" min-width="166" />
        <el-table-column v-if="!userId" prop="member" label="成员" min-width="100" />
        <el-table-column prop="label" label="行为" min-width="104" />
        <el-table-column label="行为来源" min-width="175" show-overflow-tooltip>
          <template #default="{ row }">
            <RouterLink v-if="row.route" class="source-link" :to="row.route">
              {{ row.ref }}
            </RouterLink>
            <span v-else>{{ row.ref }}</span>
          </template>
        </el-table-column>
        <el-table-column label="计入情况" min-width="175">
          <template #default="{ row }">
            <el-tag :type="row.counted ? 'success' : 'info'" size="small">
              {{ row.explanation }}
            </el-tag>
            <span v-if="row.counted" class="weight">+{{ row.countedWeight }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-pagination
      v-if="!failed && result && result.total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      :total="result.total"
      layout="prev, pager, next"
    />
  </el-drawer>
</template>

<style scoped>
.detail-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
}
.detail-results {
  min-height: 100px;
}
.source-link {
  color: var(--el-color-primary-dark-2);
  text-underline-offset: 3px;
}
.source-link:hover,
.source-link:focus-visible {
  text-decoration: underline;
}
.dimension-context {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  color: var(--el-text-color-regular);
}
.dimension-context strong {
  margin-left: 4px;
}
.detail-hint {
  font-size: 12px;
}
.weight {
  margin-left: 6px;
}
.el-pagination {
  margin-top: 12px;
}
</style>
