'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { VolumeBucket, LatencyBucket, TopRoute, ErrorGroup } from '@pulse/types'

const ANALYTICS_STALE_TIME_MS = 30 * 1000
const ANALYTICS_REFETCH_INTERVAL_MS = 60 * 1000

interface PollResult<T> {
  data: T
  isLoading: boolean
  error: string | null
  refetch: () => void
}

// Analytics endpoints sometimes wrap the payload in { data } and sometimes
// return the bare value — mirror the original unwrap behaviour.
function usePolledQuery<T>(key: readonly unknown[], url: string | null, empty: T): PollResult<T> {
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const raw = await apiFetch<{ data?: T } | T>(url as string)
      return ((raw as { data?: T }).data ?? (raw as T))
    },
    enabled: Boolean(url),
    staleTime: ANALYTICS_STALE_TIME_MS,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL_MS,
  })

  return {
    data: query.data ?? empty,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

export function useVolumeData(projectId: string, range: string) {
  const url = projectId ? `/api/projects/${projectId}/analytics/volume?range=${range}` : null
  return usePolledQuery<VolumeBucket[]>(['analytics', 'volume', projectId, range], url, [])
}

export function useLatencyData(projectId: string, range: string, route?: string) {
  const routeParam = route ? `&route=${encodeURIComponent(route)}` : ''
  const url = projectId
    ? `/api/projects/${projectId}/analytics/latency?range=${range}${routeParam}`
    : null
  return usePolledQuery<LatencyBucket[]>(
    ['analytics', 'latency', projectId, range, route ?? ''],
    url,
    [],
  )
}

export function useTopRoutes(projectId: string, range: string) {
  const url = projectId ? `/api/projects/${projectId}/analytics/top-routes?range=${range}` : null
  return usePolledQuery<TopRoute[]>(['analytics', 'top-routes', projectId, range], url, [])
}

export function useErrorList(projectId: string, range: string, view: 'open' | 'all' | 'resolved' = 'open') {
  const url = projectId
    ? `/api/projects/${projectId}/analytics/errors?range=${range}&view=${view}`
    : null
  return usePolledQuery<ErrorGroup[]>(['analytics', 'errors', projectId, range, view], url, [])
}
