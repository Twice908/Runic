'use client'

import { useState, useEffect, useRef } from 'react'
import type { RequestLogRow } from '@pulse/types'

const MAX_LOG_BUFFER = 200

export interface LiveLogsFilter {
  statusCategory?: string
  method?: string
  search?: string
}

export function useLiveLogs(projectId: string, _filter: LiveLogsFilter = {}) {
  const [logs, setLogs] = useState<RequestLogRow[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())
  const isFirstMessageRef = useRef(true)

  useEffect(() => {
    if (!projectId) return

    isFirstMessageRef.current = true
    setIsLoading(true)
    setError(null)
    setLogs([])

    const es = new EventSource(`/api/projects/${projectId}/logs/stream`)

    es.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    es.onmessage = (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as RequestLogRow
      setIsLoading(false)

      if (isFirstMessageRef.current) {
        // Batch initial logs — the server sends them in chronological order,
        // so we collect them and prepend all at once via the flush below.
        // Because each message fires separately we accumulate via functional update.
        isFirstMessageRef.current = false
      }

      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => l.id))
        if (existingIds.has(incoming.id)) return prev
        return [incoming, ...prev].slice(0, MAX_LOG_BUFFER)
      })

      setNewRowIds((prev) => new Set([...prev, incoming.id]))
      setTimeout(() => {
        setNewRowIds((prev) => {
          const next = new Set(prev)
          next.delete(incoming.id)
          return next
        })
      }, 1200)
    }

    es.onerror = () => {
      setIsConnected(false)
      setIsLoading(false)
      setError('Connection lost — reconnecting…')
    }

    return () => {
      es.close()
      setIsConnected(false)
    }
  }, [projectId])

  return { logs, isConnected, isLoading, error, newRowIds }
}
