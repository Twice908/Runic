'use client'

import { useState, useEffect, useCallback } from 'react'

const REFRESH_INTERVAL_MS = 60_000

interface PollResult<T> {
  data: T
  isLoading: boolean
  error: string | null
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

  return { data, isLoading, error }
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
  return usePollData<HitRateBucket[]>(url, [])
}

export function useTopOffenders(projectId: string, window = '24h', limit = 10, ruleId?: string) {
  const qs = new URLSearchParams({ window, limit: String(limit) })
  if (ruleId) qs.set('ruleId', ruleId)
  const url = projectId
    ? `/api/rate-limiter/${projectId}/top-offenders?${qs.toString()}`
    : null
  return usePollData<TopOffender[]>(url, [])
}
