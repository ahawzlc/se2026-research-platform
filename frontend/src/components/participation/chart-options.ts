import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption, RadarSeriesOption } from 'echarts/charts'
import type {
  DataZoomComponentOption,
  GridComponentOption,
  RadarComponentOption,
  TooltipComponentOption
} from 'echarts/components'
import type { ParticipationMember, ParticipationSummary } from '@/api/stats'

export type ParticipationOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | RadarSeriesOption
  | DataZoomComponentOption
  | GridComponentOption
  | RadarComponentOption
  | TooltipComponentOption
>

export function radarOption(
  dimensions: ParticipationSummary['dimensions'],
  member: ParticipationMember
): ParticipationOption {
  return {
    color: ['#2864b7'],
    tooltip: { renderMode: 'richText' },
    radar: {
      indicator: dimensions.map(({ label }) => ({ name: label, max: 100 })),
      radius: '61%',
      splitNumber: 4,
      axisName: { color: '#606266' },
      axisLine: { lineStyle: { color: '#dbe4ef' } },
      splitLine: { lineStyle: { color: '#dbe4ef' } },
      splitArea: { areaStyle: { color: ['#ffffff', '#f4f8fd'] } }
    },
    series: [
      {
        id: 'member-profile',
        type: 'radar',
        symbolSize: 5,
        data: [
          {
            name: member.nickname,
            value: dimensions.map(
              ({ key }) =>
                Math.round(
                  (member.dimensions.find((dimension) => dimension.key === key)?.normalized ?? 0) *
                    1000
                ) / 10
            )
          }
        ],
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2 }
      }
    ]
  }
}

export function distributionOption(members: ParticipationMember[]): ParticipationOption {
  return {
    color: ['#2864b7'],
    grid: { top: 12, bottom: 8, left: 8, right: members.length > 10 ? 38 : 16, containLabel: true },
    tooltip: { trigger: 'item', renderMode: 'richText' },
    xAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: '#ebeef5' } } },
    yAxis: {
      type: 'category',
      inverse: true,
      data: members.map(({ nickname }) => nickname),
      axisLabel: { width: 80, overflow: 'truncate' }
    },
    dataZoom:
      members.length > 10 ? [{ type: 'slider', yAxisIndex: 0, startValue: 0, endValue: 9 }] : [],
    series: [
      {
        id: 'member-distribution',
        name: '综合参与指数',
        type: 'bar',
        barMaxWidth: 24,
        showBackground: true,
        backgroundStyle: { color: '#f1f5fa', borderRadius: 5 },
        itemStyle: { borderRadius: [0, 5, 5, 0] },
        cursor: 'pointer',
        data: members.map(({ index }) => (index === null ? null : Math.round(index * 1000) / 10))
      }
    ]
  }
}

export function weeklyOption(weekly: ParticipationSummary['weekly']): ParticipationOption {
  return {
    color: ['#16806f'],
    grid: {
      top: 30,
      bottom: weekly.length > 16 ? 48 : 24,
      left: 56,
      right: 16,
      containLabel: true
    },
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    xAxis: { type: 'category', data: weekly.map(({ weekStart }) => weekStart) },
    yAxis: { type: 'value', name: '有效行为（条）', minInterval: 1 },
    dataZoom:
      weekly.length > 16
        ? [{ type: 'slider', startValue: weekly.length - 16, endValue: weekly.length - 1 }]
        : [],
    series: [
      {
        id: 'weekly-activity',
        name: '有效行为',
        type: 'line',
        symbol: 'circle',
        symbolSize: 8,
        cursor: 'pointer',
        lineStyle: { width: 2.5 },
        areaStyle: { opacity: 0.09 },
        data: weekly.map(({ count }) => count)
      }
    ]
  }
}
