'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { RequestLogRow, LogsResponse } from '@pulse/types'

// Paginated/historical logs. NOT the live tail — that stays in useLiveLogs,
// which is being moved to SSE separately.
const LOGS_STALE_TIME_MS = 10 * 1000

export interface LogsFilters {
  page?: number
  limit?: number
  status?: string
  route?: string
  timeRange?: string
}

interface LogsResult {
  logs: RequestLogRow[]
  total: number
  hasMore: boolean
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useLogs(projectId: string, filters: LogsFilters = {}): LogsResult {
  const { page = 1, limit = 50, status, route, timeRange } = filters

  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status && status !== 'all') params.set('statusCategory', status)
  if (route) params.set('search', route)
  if (timeRange) params.set('range', timeRange)

  const query = useQuery({
    queryKey: ['logs', projectId, page, limit, status ?? 'all', route ?? '', timeRange ?? ''],
    queryFn: () =>
      apiFetch<LogsResponse>(`/api/projects/${projectId}/logs?${params.toString()}`),
    enabled: Boolean(projectId),
    staleTime: LOGS_STALE_TIME_MS,
  })

  return {
    logs: query.data?.logs ?? [],
    total: query.data?.total ?? 0,
    hasMore: query.data?.hasMore ?? false,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}
