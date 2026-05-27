'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BackButton from '../BackButton'
import type { DriftEnvironmentSummary, DriftEvent } from '../types'

type DriftCellState = 'present' | 'missing' | 'extra' | 'stale'

interface MatrixRow {
  keyName: string
  cells: Record<string, DriftCellState>
}

import { EVENT_ICONS, relativeTime, scoreBgClasses, scoreColorClasses } from '../utils'

const POLL_INTERVAL_MS = 30_000
const RECENT_LIMIT = 5

interface OverviewClientProps {
  projectId: string
  initialEnvironments: DriftEnvironmentSummary[]
  initialEvents: DriftEvent[]
  initialRows?: MatrixRow[]
}

export default function OverviewClient({
  projectId,
  initialEnvironments,
  initialEvents,
  initialRows,
}: OverviewClientProps) {
  const [environments, setEnvironments] = useState(initialEnvironments)
  const [events, setEvents] = useState(initialEvents)
  const [rows, setRows] = useState<MatrixRow[]>(initialRows ?? [])
  const [mounted, setMounted] = useState(false)

  const refresh = useCallback(async () => {
    const url = `/api/drift/events/${projectId}?resolved=false&limit=${RECENT_LIMIT}`
    console.log('events fetch url:', url)
    const [matrixRes, eventsRes] = await Promise.all([
      fetch(`/api/drift/matrix/${projectId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
    const envs = matrixRes?.data?.environments ?? matrixRes?.environments
    if (envs) setEnvironments(envs)
    const r = matrixRes?.data?.rows ?? matrixRes?.rows
    if (r) setRows(r)
    const evs = eventsRes?.data?.events ?? eventsRes?.events
    if (evs) setEvents(evs)
  }, [projectId])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const driftedCountByEnv = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const env of environments) {
      counts[env.id] = rows.filter(
        (row) => row.cells[env.name] && row.cells[env.name] !== 'present',
      ).length
    }
    return counts
  }, [rows, environments])

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      <BackButton />
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Drift Overview</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Drift scores and recent events across all environments</p>
      </div>

      {/* Score cards */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Environments</h2>
          <Link
            href={`/dashboard/${projectId}/drift/environments`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Manage environments →
          </Link>
        </div>
        {environments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-10 text-center">
            <p className="text-sm text-gray-500 dark:text-slate-400">No environments yet. Send a snapshot from the agent to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {environments.map((env) => (
              <div
                key={env.id}
                className={`rounded-xl border p-5 shadow-sm ${scoreBgClasses(env.driftScore)}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{env.name}</p>
                  {env.isBaseline && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      baseline
                    </span>
                  )}
                </div>
                <p className={`mt-3 text-4xl font-semibold ${scoreColorClasses(env.driftScore)}`}>
                  {env.driftScore}
                </p>
                <ScoreBar score={env.driftScore} />
                <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">
                  {driftedCountByEnv[env.id] ?? 0} keys drifted
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  Last snapshot: {mounted ? relativeTime(env.lastSeenAt) : '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent events */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Recent Unresolved Events</h2>
          <Link
            href={`/dashboard/${projectId}/drift/events`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            View all events →
          </Link>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          {events.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">No unresolved drift events.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {events.slice(0, RECENT_LIMIT).map((ev) => {
                const icon = EVENT_ICONS[ev.driftType]
                return (
                  <li key={ev.id} className="flex items-center gap-4 px-6 py-3">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${icon.classes}`}
                    >
                      {icon.glyph}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-gray-900 dark:text-slate-100 truncate">{ev.keyName}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {icon.label} • {ev.environmentName}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-slate-400">{mounted ? relativeTime(ev.detectedAt) : '—'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <div className="flex gap-3">
        <Link
          href={`/dashboard/${projectId}/drift/matrix`}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Open full matrix
        </Link>
        <Link
          href={`/dashboard/${projectId}/drift/keys`}
          className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-100 hover:bg-gray-50"
        >
          Manage keys
        </Link>
      </div>
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const color = clamped >= 90 ? 'bg-emerald-500' : clamped >= 70 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70 dark:bg-slate-700">
      <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
    </div>
  )
}
