'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import BackButton from '../BackButton'
import type { DriftEvent, DriftEventType } from '../types'
import { EVENT_ICONS, relativeTime } from '../utils'

const POLL_INTERVAL_MS = 10_000
const PAGE_SIZE = 50

type EnvFilter = string
type TypeFilter = 'all' | DriftEventType

interface EventsApiResponse {
  data?: { events: DriftEvent[]; nextCursor: string | null }
  events?: DriftEvent[]
  nextCursor?: string | null
}

function normalize(json: EventsApiResponse | null): { events: DriftEvent[]; nextCursor: string | null } {
  if (!json) return { events: [], nextCursor: null }
  if (json.data) return { events: json.data.events ?? [], nextCursor: json.data.nextCursor ?? null }
  return { events: json.events ?? [], nextCursor: json.nextCursor ?? null }
}

export default function DriftEventsPage({
  params,
}: {
  params: { projectId: string }
}) {
  const projectId = params.projectId

  const [events, setEvents] = useState<DriftEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [envFilter, setEnvFilter] = useState<EnvFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showResolved, setShowResolved] = useState(false)

  const buildUrl = useCallback(
    (cursor?: string | null) => {
      const sp = new URLSearchParams()
      sp.set('limit', String(PAGE_SIZE))
      sp.set('resolved', String(showResolved))
      if (envFilter !== 'all') sp.set('environment', envFilter)
      if (typeFilter !== 'all') sp.set('driftType', typeFilter)
      if (cursor) sp.set('cursor', cursor)
      return `/api/drift/events/${projectId}?${sp.toString()}`
    },
    [projectId, envFilter, typeFilter, showResolved],
  )

  const loadFresh = useCallback(async () => {
    const res = await fetch(buildUrl()).catch(() => null)
    if (!res || !res.ok) {
      setLoading(false)
      return
    }
    const json = (await res.json()) as EventsApiResponse
    const norm = normalize(json)
    setEvents(norm.events)
    setNextCursor(norm.nextCursor)
    setLoading(false)
  }, [buildUrl])

  useEffect(() => {
    setLoading(true)
    loadFresh()
    const id = setInterval(loadFresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [loadFresh])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    const res = await fetch(buildUrl(nextCursor)).catch(() => null)
    if (res && res.ok) {
      const json = (await res.json()) as EventsApiResponse
      const norm = normalize(json)
      setEvents((prev) => [...prev, ...norm.events])
      setNextCursor(norm.nextCursor)
    }
    setLoadingMore(false)
  }

  const environments = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events) set.add(ev.environmentName)
    return Array.from(set).sort()
  }, [events])

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <BackButton />
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Drift Events</h1>
        <p className="text-sm text-gray-500 mt-0.5">Live feed of detected configuration drift</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <select
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="all">All environments</option>
          {environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="all">All types</option>
          <option value="MISSING_KEY">Missing key</option>
          <option value="EXTRA_KEY">Extra key</option>
          <option value="STALE_ROTATION">Stale rotation</option>
          <option value="KEY_RESTORED">Key restored</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show resolved
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No drift events.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map((ev) => {
              const icon = EVENT_ICONS[ev.driftType]
              return (
                <li key={ev.id} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${icon.classes}`}
                    title={icon.label}
                  >
                    {icon.glyph}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-gray-900 truncate">{ev.keyName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {icon.label} • {ev.environmentName}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500">{relativeTime(ev.detectedAt)}</span>
                  {ev.resolved && (
                    <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      resolved
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
