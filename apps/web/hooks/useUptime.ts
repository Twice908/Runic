'use client'

import { useState, useEffect, useCallback } from 'react'
import type { UptimeStatus } from '@pulse/types'

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
  const [data, setData] = useState<UptimeStatus>(EMPTY)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/uptime`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: UptimeStatus }
      setData(json.data ?? EMPTY)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch uptime data')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  return { data, isLoading, error }
}
