<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchMyTeams, type MyTeamItem } from '@/api/teams'
import { fetchParticipation, type ParticipationSummary } from '@/api/stats'
import ParticipationChart from '@/components/participation/ParticipationChart.vue'
import ParticipationDetails from '@/components/participation/ParticipationDetails.vue'
import ParticipationMethod from '@/components/participation/ParticipationMethod.vue'
import {
  distributionOption,
  radarOption,
  weeklyOption
} from '@/components/participation/chart-options'

const disclaimer = '本图表反映成员在平台内的协作行为分布，仅作团队过程参考，不构成科研贡献评价。'
const route = useRoute()
const router = useRouter()
const teams = ref<MyTeamItem[]>([])
const teamId = ref('')
const teamsAttempt = ref(0)
const teamsLoading = ref(false)
const teamsFailed = ref(false)
const summary = ref<ParticipationSummary | null>(null)
const summaryAttempt = ref(0)
const summaryLoading = ref(false)
const summaryFailed = ref(false)
const selectedUserId = ref('')
const detailsOpen = ref(false)
const methodOpen = ref(false)
const detailFilter = ref<{ userId?: string; dimension?: string; weekStart?: string }>({})

const team = computed(() => teams.value.find((item) => item.id === teamId.value))
const activeMembers = computed(
  () => summary.value?.members.filter((member) => member.hasData) ?? []
)
const selectedMember = computed(() =>
  activeMembers.value.find((member) => member.userId === selectedUserId.value)
)
const radar = computed(() =>
  summary.value && selectedMember.value
    ? radarOption(summary.value.dimensions, selectedMember.value)
    : null
)
const distribution = computed(() => distributionOption(activeMembers.value))
const weekly = computed(() => weeklyOption(summary.value?.weekly ?? []))
const selectedDimensions = computed(
  () =>
    summary.value?.dimensions.map((dimension) => ({
      ...dimension,
      value: selectedMember.value?.dimensions.find((value) => value.key === dimension.key)
    })) ?? []
)

watch(
  teamsAttempt,
  async (_attempt, _previous, onCleanup) => {
    let active = true
    onCleanup(() => {
      active = false
    })
    teamsLoading.value = true
    teamsFailed.value = false
    try {
      const data = await fetchMyTeams()
      if (!active) return
      teams.value = data
      teamId.value = data.find((item) => item.id === route.query.teamId)?.id ?? data[0]?.id ?? ''
    } catch {
      if (active) teamsFailed.value = true
    } finally {
      if (active) teamsLoading.value = false
    }
  },
  { immediate: true }
)

watch(
  () => route.query.teamId,
  (id) => {
    const match = teams.value.find((item) => item.id === id)
    if (match) teamId.value = match.id
  }
)

watch([teamId, summaryAttempt], async ([id], [previousId], onCleanup) => {
  const request = new window.AbortController()
  onCleanup(() => request.abort())
  if (id !== previousId) {
    detailsOpen.value = false
    methodOpen.value = false
    summary.value = null
    selectedUserId.value = ''
  }
  summaryFailed.value = false
  summaryLoading.value = Boolean(id)
  if (!id) return
  try {
    const data = await fetchParticipation(id, request.signal)
    if (request.signal.aborted) return
    summary.value = data
    if (!data.members.some((member) => member.userId === selectedUserId.value && member.hasData))
      selectedUserId.value = data.members.find((member) => member.hasData)?.userId ?? ''
  } catch {
    if (!request.signal.aborted) summaryFailed.value = true
  } finally {
    if (!request.signal.aborted) summaryLoading.value = false
  }
})

function selectTeam() {
  void router.replace({ query: { ...route.query, teamId: teamId.value } })
}

function showDetails(filter: typeof detailFilter.value = {}) {
  detailFilter.value = filter
  detailsOpen.value = true
}

function selectBar(index: number) {
  const member = activeMembers.value[index]
  if (!member) return
  selectedUserId.value = member.userId
  showDetails({ userId: member.userId })
}

function selectWeek(index: number) {
  const week = summary.value?.weekly[index]
  if (week) showDetails({ weekStart: week.weekStart })
}
</script>

<template>
  <section class="participation" aria-labelledby="participation-title">
    <header class="page-card overview">
      <div class="heading">
        <div class="intro">
          <span class="eyebrow">团队协作 · 参与度分析</span>
          <h1 id="participation-title">团队参与度画像</h1>
          <p>从任务推进到讨论互动，查看每条行为如何计入画像。</p>
        </div>
        <div v-if="teams.length" class="actions">
          <el-select
            v-model="teamId"
            aria-label="选择课题组"
            class="team-picker"
            @change="selectTeam"
          >
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <el-button :loading="summaryLoading" @click="summaryAttempt++">刷新数据</el-button>
        </div>
      </div>
      <div class="disclaimer">
        <span>{{ summary?.disclaimer ?? disclaimer }}</span>
        <el-button v-if="summary" type="primary" link @click="methodOpen = true">
          查看统计口径
        </el-button>
      </div>
    </header>

    <div v-if="!summary && (teamsLoading || summaryLoading)" class="page-card" aria-live="polite">
      <el-skeleton :rows="7" animated />
    </div>
    <el-result
      v-else-if="!summary && (teamsFailed || summaryFailed)"
      class="page-card"
      icon="error"
      title="参与度数据加载失败"
    >
      <template #extra>
        <el-button @click="teamsFailed ? teamsAttempt++ : summaryAttempt++">重试</el-button>
      </template>
    </el-result>
    <el-empty
      v-else-if="!teams.length"
      class="page-card"
      description="加入或创建课题组后即可查看参与度"
    >
      <el-button type="primary" @click="router.push({ name: 'members' })">前往课题组成员</el-button>
    </el-empty>

    <Transition name="participation-enter">
      <div v-if="summary" :key="summary.teamId" class="data-stack" :aria-busy="summaryLoading">
        <el-alert
          v-if="summaryFailed"
          type="warning"
          title="刷新失败，当前显示上次成功加载的数据"
          :closable="false"
          show-icon
        />
        <div class="metric-grid" aria-label="团队统计概览">
          <div class="page-card metric">
            <span>有效行为</span>
            <strong>
              {{ summary.sampleSize }}
              <small>条</small>
            </strong>
          </div>
          <div class="page-card metric">
            <span>有记录的成员</span>
            <strong>
              {{ activeMembers.length }}
              <small>/ {{ summary.memberCount }} 人</small>
            </strong>
          </div>
          <div class="page-card metric">
            <span>有记录的周</span>
            <strong>
              {{ summary.weekly.length }}
              <small>周</small>
            </strong>
          </div>
        </div>

        <el-empty
          v-if="!summary.hasData"
          class="page-card"
          description="当前课题组暂无有效行为记录"
        >
          <div class="empty-actions">
            <el-button type="primary" @click="router.push({ name: 'tasks' })">
              前往任务看板
            </el-button>
            <el-button @click="showDetails()">查看行为明细</el-button>
          </div>
        </el-empty>
        <template v-else>
          <el-alert
            v-if="summary.insufficientSample"
            type="warning"
            :closable="false"
            show-icon
            :title="`样本量较小：已计入 ${summary.sampleSize} 条行为（参考阈值 ${summary.sampleThreshold} 条），请结合实际协作情况解读。`"
          />
          <section class="charts">
            <article class="page-card chart-card">
              <div class="chart-heading">
                <div>
                  <h2>成员六维画像</h2>
                  <p>按各维度组内最大值换算为 0–100。</p>
                </div>
                <el-select v-model="selectedUserId" aria-label="选择画像成员" class="member-picker">
                  <el-option
                    v-for="member in activeMembers"
                    :key="member.userId"
                    :label="member.nickname"
                    :value="member.userId"
                  />
                </el-select>
              </div>
              <ParticipationChart v-if="radar" :option="radar" label="成员六维参与度雷达图" />
              <div class="dimension-grid">
                <button
                  v-for="item in selectedDimensions"
                  :key="item.key"
                  type="button"
                  :aria-label="`查看${item.label}明细`"
                  @click="showDetails({ userId: selectedUserId, dimension: item.key })"
                >
                  <span>{{ item.label }}</span>
                  <strong>{{ ((item.value?.normalized ?? 0) * 100).toFixed(0) }}</strong>
                </button>
              </div>
            </article>
            <article class="page-card chart-card">
              <div class="chart-heading">
                <div>
                  <h2>成员参与指数分布</h2>
                  <p>点击成员柱形可下钻至计入明细。</p>
                </div>
                <el-tag type="info" effect="plain" size="small">仅供参考</el-tag>
              </div>
              <ParticipationChart
                :option="distribution"
                label="成员参与指数分布柱状图"
                @select="selectBar"
              />
              <p class="chart-note">
                指数仅在本组统计范围内比较。暂无有效行为的成员可在成员列表查看。
              </p>
            </article>
          </section>

          <section class="page-card chart-card">
            <div class="chart-heading">
              <div>
                <h2>每周有效行为</h2>
                <p>按北京时间周一归组。点击数据点查看对应周明细。</p>
              </div>
              <el-button size="small" @click="selectWeek(summary.weekly.length - 1)">
                查看最近活跃周
              </el-button>
            </div>
            <ParticipationChart :option="weekly" label="每周有效行为趋势图" @select="selectWeek" />
          </section>

          <section class="page-card chart-card">
            <div class="chart-heading table-heading">
              <div>
                <h2>成员明细</h2>
                <p>{{ team?.name }} · {{ summary.memberCount }} 位成员</p>
              </div>
              <el-button size="small" @click="showDetails()">查看团队行为</el-button>
            </div>
            <el-table :data="summary.members" row-key="userId" max-height="420">
              <el-table-column prop="nickname" label="成员" min-width="120" />
              <el-table-column label="综合参与指数（0–100）" min-width="155">
                <template #default="{ row }">
                  <span :class="{ muted: row.index === null }">
                    {{ row.index === null ? '暂无有效记录' : (row.index * 100).toFixed(1) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="操作" min-width="100" align="right">
                <template #default="{ row }">
                  <el-button
                    link
                    type="primary"
                    :aria-label="`查看 ${row.nickname} 的行为明细`"
                    @click="showDetails({ userId: row.userId })"
                  >
                    行为明细
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </template>

        <ParticipationDetails
          v-model="detailsOpen"
          :team-id="summary.teamId"
          :filter="detailFilter"
          :dimensions="summary.dimensions"
          :members="summary.members"
          :weeks="summary.weekly"
        />
        <ParticipationMethod
          v-model="methodOpen"
          :dimensions="summary.dimensions"
          :version="summary.modelVersion"
          :threshold="summary.sampleThreshold"
        />
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.participation,
.data-stack {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.participation {
  max-width: 1480px;
  margin: 0 auto;
}
.overview {
  background: linear-gradient(110deg, #fff 55%, var(--el-color-primary-light-9));
}
.heading,
.chart-heading,
.actions,
.disclaimer,
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.heading,
.chart-heading,
.disclaimer {
  justify-content: space-between;
}
.heading {
  margin-bottom: 18px;
}
.eyebrow {
  color: var(--el-color-primary-dark-2);
  font-size: 12px;
  font-weight: 600;
}
h1,
h2,
p {
  margin: 0;
}
h1 {
  margin-top: 6px;
  font-size: clamp(22px, 3vw, 28px);
  font-weight: 650;
  letter-spacing: -0.02em;
}
h2 {
  font-size: 16px;
}
p,
.muted {
  color: var(--el-text-color-secondary);
}
p {
  margin-top: 6px;
  line-height: 1.5;
}
.disclaimer {
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
}
.actions {
  flex-wrap: nowrap;
  max-width: 100%;
}
.actions .el-button {
  flex: none;
}
.team-picker {
  width: 200px;
  min-width: 0;
}
.member-picker {
  width: 144px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.metric {
  display: grid;
  gap: 8px;
  padding: 14px 18px;
}
.metric span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.metric strong {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.metric small {
  color: var(--el-text-color-regular);
  font-size: 12px;
  font-weight: 400;
}
.charts {
  display: grid;
  grid-template-columns: 1.07fr 1fr;
  gap: 16px;
}
.chart-card {
  min-width: 0;
}
.chart-heading {
  min-height: 42px;
}
.chart-note {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
}
.dimension-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.dimension-grid button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 8px;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}
.dimension-grid button:hover,
.dimension-grid button:focus-visible {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}
.dimension-grid strong {
  color: var(--el-color-primary-dark-2);
  font-variant-numeric: tabular-nums;
}
.table-heading {
  margin-bottom: 8px;
}
.participation-enter-enter-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}
.participation-enter-enter-from {
  opacity: 0;
  transform: translateY(5px);
}
@media (max-width: 1120px) {
  .charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 720px) {
  .metric-grid {
    gap: 6px;
  }
  .metric {
    padding: 10px 8px;
  }
  .metric strong {
    font-size: 19px;
  }
  .page-card:not(.metric) {
    padding: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .participation-enter-enter-active,
  .dimension-grid button {
    transition: none;
  }
}
</style>
