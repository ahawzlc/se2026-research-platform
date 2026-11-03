<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption } from 'echarts/charts'
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  TitleComponentOption
} from 'echarts/components'
import { projectsApi } from '@/api'
import type { ProjectItem } from '@/api/projects'

/** 组合后的图表配置类型 */
type ChartOption = ComposeOption<
  | BarSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | TitleComponentOption
>

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer
])

/** 甘特图数据行 */
interface GanttRow {
  name: string
  /** 开始日期 yyyy-MM-dd */
  start: string
  /** 结束日期 yyyy-MM-dd */
  end: string
  /** 是否已过期 */
  overdue: boolean
  /** 里程碑 id（用于点击跳转） */
  id: string
}

const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const chartRef = ref<HTMLElement | null>(null)
const loading = ref(false)
let chart: echarts.ECharts | null = null

const currentProject = computed(() =>
  projects.value.find((p) => p.id === currentProjectId.value)
)

/**
 * 甘特图行数据：里程碑按截止日期排布。
 *
 * 里程碑的「开始日期」取项目开始日期（里程碑表只有 due_date 一个日期字段，
 * 详见 docs/02 milestone 表），因此同一项目的多个里程碑会呈现为
 * 「项目起点 → 各截止点」的阶梯形状。
 */
const rows = ref<GanttRow[]>([])

async function loadProjects(): Promise<void> {
  const result = await projectsApi.fetchProjects({ page: 1, size: 100 })
  projects.value = result.list
  if (!projects.value.some((p) => p.id === currentProjectId.value)) {
    currentProjectId.value = projects.value[0]?.id ?? ''
  }
}

async function loadMilestones(): Promise<void> {
  if (!currentProjectId.value) {
    rows.value = []
    await render()
    return
  }
  loading.value = true
  try {
    const info = await projectsApi.fetchProject(currentProjectId.value)
    const milestones = await projectsApi.fetchMilestones(currentProjectId.value)
    const today = new Date().toISOString().slice(0, 10)

    rows.value = milestones
      .filter((m) => m.dueDate)
      .map((m) => ({
        id: m.id,
        name: m.name,
        start: info.startDate || m.dueDate,
        end: m.dueDate,
        overdue: m.status !== 'done' && m.dueDate < today
      }))
      .sort((a, b) => a.end.localeCompare(b.end))
    await render()
  } catch {
    rows.value = []
    await render()
  } finally {
    loading.value = false
  }
}

/** 计算图表所需的日期边界 */
function dateRange(): { min: number; max: number } {
  if (rows.value.length === 0) {
    const now = Date.now()
    return { min: now - 86400000 * 7, max: now + 86400000 * 30 }
  }
  const times = rows.value.flatMap((r) => [toTime(r.start), toTime(r.end)])
  const min = Math.min(...times)
  const max = Math.max(...times)
  // 两侧各留 7 天余量，避免柱子贴边
  return { min: min - 86400000 * 7, max: max + 86400000 * 7 }
}

function toTime(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime()
}

/**
 * 渲染图表。
 *
 * `rows` 是响应式数据，但图表容器 `chartRef` 的挂载是异步的（v-if/v-else 分支），
 * 因此这里先 `await nextTick()` 等 DOM 更新完成再初始化 ECharts，
 * 否则首次进入页面会因 chartRef 仍为 null 而画不出图。
 */
async function render(): Promise<void> {
  await nextTick()
  if (!chartRef.value) return
  // 容器节点可能因 v-if 分支切换而被替换，此时旧的实例仍绑定在已卸载的 DOM 上，需重建
  if (chart && chart.getDom() !== chartRef.value) {
    chart.dispose()
    chart = null
  }
  if (!chart) {
    chart = echarts.init(chartRef.value)
  }
  const { min, max } = dateRange()

  const option: ChartOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params
        const row = rows.value[first.dataIndex]
        if (!row) return ''
        const status = row.overdue ? '已逾期' : '进行中'
        return `${row.name}<br/>${row.start} ~ ${row.end}<br/>${status}`
      }
    } as TooltipComponentOption,
    grid: { left: 140, right: 32, top: 32, bottom: 48 },
    xAxis: {
      type: 'time',
      min,
      max,
      axisLabel: { formatter: '{MM}-{dd}' },
      splitLine: { show: true }
    },
    yAxis: {
      type: 'category',
      data: rows.value.map((r) => r.name),
      axisLabel: { width: 120, overflow: 'truncate' }
    },
    series: [
      {
        type: 'bar',
        // 每行两个数据：[开始时间, 结束时间]，横向渲染成一根条
        data: rows.value.map((r) => ({
          value: [toTime(r.start), toTime(r.end)],
          itemStyle: {
            color: r.overdue ? '#f56c6c' : '#409eff'
          }
        })),
        barWidth: 18
      }
    ]
  }
  chart.setOption(option, true)
}

function handleResize(): void {
  chart?.resize()
}

watch(currentProjectId, () => {
  void loadMilestones()
})

onMounted(async () => {
  await loadProjects()
  await loadMilestones()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="gantt-page">
    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <el-select
            v-model="currentProjectId"
            placeholder="选择项目"
            class="project-select"
            :disabled="projects.length === 0"
          >
            <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
          <span v-if="currentProject" class="project-meta">
            {{ currentProject.startDate || '未定' }} ~ {{ currentProject.endDate || '未定' }}
          </span>
        </div>
      </template>

      <el-empty v-if="projects.length === 0 && !loading" description="还没有项目">
        <p class="empty-hint">请先到「项目管理」创建项目并添加里程碑</p>
      </el-empty>

      <template v-else>
        <el-alert
          v-if="rows.length === 0"
          type="info"
          :closable="false"
          show-icon
          title="该项目还没有带截止日期的里程碑"
          description="到「项目管理 → 里程碑」添加里程碑后，这里会展示项目进度甘特图。"
        />
        <div v-else ref="chartRef" v-loading="loading" class="chart-box" />
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.project-select {
  width: 240px;
}

.project-meta {
  font-size: 13px;
  color: #909399;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.chart-box {
  width: 100%;
  height: 420px;
}
</style>
