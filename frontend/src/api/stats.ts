import { http } from './request'
import type { PageQuery, PageResult } from './types'

export interface ParticipationDimension {
  key: string
  label: string
  weight: number
  max: number
}

export interface ParticipationMember {
  userId: string
  nickname: string
  hasData: boolean
  index: number | null
  dimensions: { key: string; raw: number; normalized: number }[]
}

export interface ParticipationSummary {
  teamId: string
  modelVersion: string
  disclaimer: string
  hasData: boolean
  memberCount: number
  sampleSize: number
  sampleThreshold: number
  insufficientSample: boolean
  dimensions: ParticipationDimension[]
  members: ParticipationMember[]
  weekly: { weekStart: string; count: number; weight: number }[]
}

export interface ParticipationEvent {
  id: string
  userId: string
  type: string
  refType: string | null
  refId: string | null
  createdAt: string
  countedWeight: number
  counted: boolean
  reason: string
  source: {
    kind: 'task' | 'milestone' | 'literature' | 'meeting' | 'achievement'
    id: string
    title: string
    projectId: string | null
  } | null
}

export function fetchParticipation(teamId: string, signal?: AbortSignal) {
  return http.get<ParticipationSummary>('/api/v1/stats/contribution', {
    params: { teamId },
    signal
  })
}

export function fetchParticipationDetails(
  params: PageQuery & { teamId: string; userId?: string; dimension?: string; weekStart?: string },
  signal?: AbortSignal
) {
  return http.get<PageResult<ParticipationEvent>>('/api/v1/stats/contribution/details', {
    params,
    signal
  })
}
