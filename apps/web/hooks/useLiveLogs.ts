'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { RequestLogRow } from '@pulse/types'

const POLL_INTERVAL_MS = 3_000
const MAX_LOG_BUFFER = 500

export function useLiveLogs(projectId: string, statusCategory: string) {
  const [logs, setLogs] = useState<RequestLogRow[]>([])
  const [isPolling, setIsPolling] = useState(false)
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())
  const lastTimestampRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNewLogs = useCallback(async () => {
    if (document.visibilityState === 'hidden') return

    const params = new URLSearchParams()
    if (lastTimestampRef.current) params.set('since', lastTimestampRef.current)
    if (statusCategory !== 'all') params.set('statusCategory', statusCategory)

    try {
      const res = await fetch(`/api/projects/${projectId}/logs?${params.toString()}`)
      if (!res.ok) return

      const data = (await res.json()) as { logs: RequestLogRow[] }
      const incoming = data.logs ?? []

      if (incoming.length > 0) {
        lastTimestampRef.current = incoming[0].timestamp
        const ids = new Set(incoming.map((l) => l.id))
        setNewRowIds(ids)
        setTimeout(() => setNewRowIds(new Set()), 1200)
        setLogs((prev) => [...incoming, ...prev].slice(0, MAX_LOG_BUFFER))
      }
    } catch {
      // Polling failures are silent — live feed should never crash the UI
    }
  }, [projectId, statusCategory])

  useEffect(() => {
    setLogs([])
    lastTimestampRef.current = null
    fetchNewLogs()

    setIsPolling(true)
    intervalRef.current = setInterval(fetchNewLogs, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setIsPolling(false)
    }
  }, [fetchNewLogs])

  return { logs, isPolling, newRowIds }
}
