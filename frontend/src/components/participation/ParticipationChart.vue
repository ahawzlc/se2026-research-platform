<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart, RadarChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  RadarComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ParticipationOption } from './chart-options'

use([
  BarChart,
  LineChart,
  RadarChart,
  DataZoomComponent,
  GridComponent,
  RadarComponent,
  TooltipComponent,
  CanvasRenderer
])

const props = defineProps<{ option: ParticipationOption; label: string }>()
const emit = defineEmits<{ select: [index: number] }>()
const element = ref<HTMLElement | null>(null)
let chart: EChartsType | undefined
let observer: InstanceType<typeof window.ResizeObserver> | undefined
let motion: ReturnType<typeof window.matchMedia> | undefined

function render() {
  chart?.setOption(
    {
      ...props.option,
      animation: !motion?.matches,
      animationDuration: 420,
      animationDurationUpdate: 280,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut'
    },
    { replaceMerge: ['series', 'dataZoom'] }
  )
}

onMounted(() => {
  if (!element.value) return
  chart = init(element.value)
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', render)
  render()
  chart.on('click', { componentType: 'series' }, ({ dataIndex }) => {
    if (typeof dataIndex === 'number') emit('select', dataIndex)
  })
  observer = new window.ResizeObserver(() => chart?.resize())
  observer.observe(element.value)
})

watch(() => props.option, render)

onBeforeUnmount(() => {
  motion?.removeEventListener('change', render)
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div ref="element" class="chart" role="img" :aria-label="label" />
</template>

<style scoped>
.chart {
  width: 100%;
  min-width: 0;
  height: 320px;
}
</style>
