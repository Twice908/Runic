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

  const fetchNewLogs = useCallback(async (signal: AbortSignal) => {
    if (document.visibilityState === 'hidden') return

    const params = new URLSearchParams()
    if (lastTimestampRef.current) params.set('since', lastTimestampRef.current)
    if (statusCategory !== 'all') params.set('statusCategory', statusCategory)

    try {
      const res = await fetch(`/api/projects/${projectId}/logs?${params.toString()}`, { signal })
      if (!res.ok) return

      const data = (await res.json()) as { logs: RequestLogRow[] }
      const incoming = data.logs ?? []

      if (incoming.length > 0) {
        lastTimestampRef.current = incoming[0].timestamp
        const incomingIds = new Set(incoming.map((l) => l.id))
        setNewRowIds(incomingIds)
        setTimeout(() => setNewRowIds(new Set()), 1200)
        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id))
          const fresh = incoming.filter((l) => !existingIds.has(l.id))
          if (fresh.length === 0) return prev
          return [...fresh, ...prev].slice(0, MAX_LOG_BUFFER)
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      // Other polling failures are silent — live feed should never crash the UI
    }
  }, [projectId, statusCategory])

  useEffect(() => {
    const controller = new AbortController()

    setLogs([])
    lastTimestampRef.current = null
    fetchNewLogs(controller.signal)

    setIsPolling(true)
    const intervalId = setInterval(() => fetchNewLogs(controller.signal), POLL_INTERVAL_MS)

    return () => {
      controller.abort()
      clearInterval(intervalId)
      setIsPolling(false)
    }
  }, [fetchNewLogs])

  return { logs, isPolling, newRowIds }
}
