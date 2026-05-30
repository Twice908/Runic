'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { UptimeStatus } from '@pulse/types'

const UPTIME_STALE_TIME_MS = 60 * 1000
const UPTIME_REFETCH_INTERVAL_MS = 60 * 1000

const EMPTY: UptimeStatus = {
  current: 'up',
  uptimePercent24h: 100,
  avgResponseTime24h: 0,
  checks: [],
}

interface UptimeResult {
  data: UptimeStatus
  isLoading: boolean
  error: string | null
}

export function useUptime(projectId: string): UptimeResult {
  const query = useQuery({
    queryKey: ['uptime', projectId],
    queryFn: () => apiFetch<{ data?: UptimeStatus }>(`/api/projects/${projectId}/uptime`),
    enabled: Boolean(projectId),
    staleTime: UPTIME_STALE_TIME_MS,
    refetchInterval: UPTIME_REFETCH_INTERVAL_MS,
  })

  return {
    data: query.data?.data ?? EMPTY,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}
