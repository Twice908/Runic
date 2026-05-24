'use client'

import { useState, useEffect, useCallback } from 'react'
import type { VolumeBucket, LatencyBucket, TopRoute, ErrorGroup } from '@pulse/types'

const REFRESH_INTERVAL_MS = 60_000

interface PollResult<T> {
  data: T
  isLoading: boolean
  error: string | null
  refetch: () => void
}

function usePollData<T>(url: string | null, empty: T): PollResult<T> {
  const [data, setData] = useState<T>(empty)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!url || document.visibilityState === 'hidden') return
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: T }
      setData(json.data ?? (json as T))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    } finally {
      setIsLoading(false)
    }
  }, [url])

  useEffect(() => {
    setIsLoading(true)
    setData(empty)
    if (!url) {
      setIsLoading(false)
      return
    }
    fetchData()
    const id = setInterval(fetchData, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  // empty is a stable reference ([] or similar) — intentionally not a dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, url])

  return { data, isLoading, error, refetch: fetchData }
}

export function useVolumeData(projectId: string, range: string) {
  const url = projectId ? `/api/projects/${projectId}/analytics/volume?range=${range}` : null
  return usePollData<VolumeBucket[]>(url, [])
}

export function useLatencyData(projectId: string, range: string, route?: string) {
  const routeParam = route ? `&route=${encodeURIComponent(route)}` : ''
  const url = projectId ? `/api/projects/${projectId}/analytics/latency?range=${range}${routeParam}` : null
  return usePollData<LatencyBucket[]>(url, [])
}

export function useTopRoutes(projectId: string, range: string) {
  const url = projectId ? `/api/projects/${projectId}/analytics/top-routes?range=${range}` : null
  return usePollData<TopRoute[]>(url, [])
}

export function useErrorList(projectId: string, range: string, view: 'open' | 'all' | 'resolved' = 'open') {
  const url = projectId ? `/api/projects/${projectId}/analytics/errors?range=${range}&view=${view}` : null
  return usePollData<ErrorGroup[]>(url, [])
}
