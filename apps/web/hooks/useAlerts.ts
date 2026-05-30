'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AlertRule, AlertHistoryEntry } from '@pulse/types'

interface AlertsResult {
  data: AlertRule[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

interface HistoryResult {
  data: AlertHistoryEntry[]
  total: number
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useAlerts(projectId: string): AlertsResult {
  const [data, setData] = useState<AlertRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/alerts`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: AlertRule[] }
      setData(json.data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch alerts')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

export function useAlertHistory(projectId: string, page: number): HistoryResult {
  const [data, setData] = useState<AlertHistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/alerts/history?page=${page}&limit=20`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = (await r.json()) as { data?: AlertHistoryEntry[]; total?: number }
      setData(json.data ?? [])
      setTotal(json.total ?? 0)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch history')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, page])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, total, isLoading, error, refetch: fetchData }
}
