'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

const RL_ANALYTICS_STALE_TIME_MS = 30 * 1000
const RL_ANALYTICS_REFETCH_INTERVAL_MS = 60 * 1000

interface PollResult<T> {
  data: T
  isLoading: boolean
  error: string | null
}

function usePolledQuery<T>(key: readonly unknown[], url: string | null, empty: T): PollResult<T> {
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const raw = await apiFetch<{ data?: T } | T>(url as string)
      return ((raw as { data?: T }).data ?? (raw as T))
    },
    enabled: Boolean(url),
    staleTime: RL_ANALYTICS_STALE_TIME_MS,
    refetchInterval: RL_ANALYTICS_REFETCH_INTERVAL_MS,
  })

  return {
    data: query.data ?? empty,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}

export interface HitRateBucket {
  bucket: string
  ruleId: string
  ruleName: string
  allowed: number
  blocked: number
}

export interface TopOffender {
  limitKey: string
  ruleId: string
  ruleName: string
  blockCount: number
  lastSeen: string
}

export function useHitRate(projectId: string, window = '24h', ruleId?: string) {
  const qs = new URLSearchParams({ window })
  if (ruleId) qs.set('ruleId', ruleId)
  const url = projectId ? `/api/rate-limiter/${projectId}/hit-rate?${qs.toString()}` : null
  return usePolledQuery<HitRateBucket[]>(
    ['rate-limiter', 'hit-rate', projectId, window, ruleId ?? ''],
    url,
    [],
  )
}

export function useTopOffenders(projectId: string, window = '24h', limit = 10, ruleId?: string) {
  const qs = new URLSearchParams({ window, limit: String(limit) })
  if (ruleId) qs.set('ruleId', ruleId)
  const url = projectId
    ? `/api/rate-limiter/${projectId}/top-offenders?${qs.toString()}`
    : null
  return usePolledQuery<TopOffender[]>(
    ['rate-limiter', 'top-offenders', projectId, window, limit, ruleId ?? ''],
    url,
    [],
  )
}
