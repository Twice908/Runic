'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ProjectStats } from '@pulse/types'

const STATS_STALE_TIME_MS = 30 * 1000

interface StatsResult {
  data: ProjectStats | null
  isLoading: boolean
  error: string | null
}

export function useStats(projectId: string): StatsResult {
  const query = useQuery({
    queryKey: ['stats', projectId],
    queryFn: () => apiFetch<ProjectStats>(`/api/projects/${projectId}/stats`),
    enabled: Boolean(projectId),
    staleTime: STATS_STALE_TIME_MS,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}
