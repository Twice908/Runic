'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { relativeTime } from '@/lib/utils'

// ─── types ────────────────────────────────────────────────────────────────────

interface RateLimitEventRow {
  id: string
  projectId: string
  ruleId: string
  ruleName?: string
  limitKey: string
  path: string
  action: 'blocked' | 'logged'
  timestamp: string
}

type ActionFilter = 'all' | 'blocked' | 'logged'

// ─── hook — mirrors useLiveLogs exactly ──────────────────────────────────────

const POLL_INTERVAL_MS = 3_000
const MAX_EVENT_BUFFER = 500

function useLiveRateLimitEvents(projectId: string, filter: ActionFilter) {
  const [events, setEvents] = useState<RateLimitEventRow[]>([])
  const [isPolling, setIsPolling] = useState(false)
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())
  const lastTimestampRef = useRef<string | null>(null)

  const fetchNewEvents = useCallback(
    async (signal: AbortSignal) => {
      if (document.visibilityState === 'hidden') return

      const params = new URLSearchParams()
      if (lastTimestampRef.current) params.set('since', lastTimestampRef.current)
      if (filter !== 'all') params.set('action', filter)

      try {
        const res = await fetch(
          `/api/rate-limiter/${projectId}/events?${params.toString()}`,
          { signal },
        )
        if (!res.ok) return

        const data = (await res.json()) as { data?: RateLimitEventRow[] }
        const incoming = data.data ?? []

        if (incoming.length > 0) {
          lastTimestampRef.current = incoming[0].timestamp
          const incomingIds = new Set(incoming.map((e) => e.id))
          setNewRowIds(incomingIds)
          setTimeout(() => setNewRowIds(new Set()), 1200)
          setEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id))
            const fresh = incoming.filter((e) => !existingIds.has(e.id))
            if (fresh.length === 0) return prev
            return [...fresh, ...prev].slice(0, MAX_EVENT_BUFFER)
          })
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
      }
    },
    [projectId, filter],
  )

  useEffect(() => {
    const controller = new AbortController()
    setEvents([])
    lastTimestampRef.current = null
    fetchNewEvents(controller.signal)
    setIsPolling(true)
    const intervalId = setInterval(() => fetchNewEvents(controller.signal), POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      clearInterval(intervalId)
      setIsPolling(false)
    }
  }, [fetchNewEvents])

  return { events, isPolling, newRowIds }
}

// ─── page ─────────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, string> = {
  blocked: 'bg-red-100 text-red-700',
  logged: 'bg-yellow-100 text-yellow-700',
}

export default function RateLimiterEventsPage() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project') ?? ''
  const [filter, setFilter] = useState<ActionFilter>('all')
  const { events, isPolling, newRowIds } = useLiveRateLimitEvents(projectId, filter)
  const router = useRouter()

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project from the sidebar.</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-8">
      <button
        onClick={() => router.push(`/dashboard/rate-limiter?project=${projectId}`)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to overview
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Rate Limit Events</h1>
          <p className="text-sm text-gray-500 mt-0.5">Live feed of rate limit decisions</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Filter tabs */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['all', 'blocked', 'logged'] as ActionFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={[
                  'px-4 py-1.5 font-medium transition-colors capitalize',
                  filter === f
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span
              className={`h-2 w-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}
            />
            {isPolling ? 'Live' : 'Paused'}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-700">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Path
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Rule
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Key Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Action
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                    Waiting for rate limit events…
                  </td>
                </tr>
              )}
              {events.map((event) => {
                const isNew = newRowIds.has(event.id)
                return (
                  <tr
                    key={event.id}
                    className={[
                      'border-b border-gray-100 dark:border-slate-700 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-slate-700',
                      isNew ? 'animate-flash-new' : '',
                    ].join(' ')}
                  >
                    <td className="px-6 py-3 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-800 dark:text-slate-100">{event.path}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-400">
                      {event.ruleName ?? event.ruleId.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-slate-400 max-w-[160px] truncate">
                      {event.limitKey}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ACTION_STYLES[event.action] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {event.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500 dark:text-slate-500">
                      {relativeTime(event.timestamp)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
