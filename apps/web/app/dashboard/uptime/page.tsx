'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { useUptime } from '@/hooks/useUptime'
import { useAlerts } from '@/hooks/useAlerts'
import type { UptimeCheck } from '@pulse/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function bucketByHour(checks: UptimeCheck[]): Array<{ hour: string; upCount: number; downCount: number }> {
  const map = new Map<string, { upCount: number; downCount: number }>()
  const now = Date.now()

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 60 * 60 * 1000)
    const key = `${d.getHours().toString().padStart(2, '0')}:00`
    map.set(key, { upCount: 0, downCount: 0 })
  }

  for (const c of checks) {
    const d = new Date(c.checkedAt)
    if (Date.now() - d.getTime() > 24 * 60 * 60 * 1000) continue
    const key = `${d.getHours().toString().padStart(2, '0')}:00`
    const bucket = map.get(key)
    if (!bucket) continue
    if (c.status === 'up') bucket.upCount++
    else bucket.downCount++
  }

  return Array.from(map.entries()).map(([hour, counts]) => ({ hour, ...counts }))
}

// ── status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'up' | 'down' }) {
  return (
    <span className="relative flex h-3 w-3">
      <span
        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
          status === 'up' ? 'bg-green-400' : 'bg-red-400'
        }`}
      />
      <span
        className={`relative inline-flex rounded-full h-3 w-3 ${
          status === 'up' ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
    </span>
  )
}

// ── uptime card ───────────────────────────────────────────────────────────────

interface UptimeCardProps {
  projectId: string
  url: string
}

function UptimeCard({ projectId, url }: UptimeCardProps) {
  const { data, isLoading, error } = useUptime(projectId)
  const hourly = bucketByHour(data.checks)

  if (isLoading) {
    return <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot status={data.current} />
          <span className="text-sm font-medium text-gray-900 truncate">{url}</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            data.current === 'up' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {data.current.toUpperCase()}
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Uptime (24h)</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{data.uptimePercent24h.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">Avg Response</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {data.avgResponseTime24h > 0 ? `${data.avgResponseTime24h}ms` : '—'}
          </p>
        </div>
      </div>

      {/* Timeline chart */}
      {data.checks.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Last 24h (hourly)</p>
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={hourly} barSize={6} barCategoryGap="20%">
              <XAxis dataKey="hour" tick={false} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value, name) => [value, name === 'upCount' ? 'Up checks' : 'Down checks']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="upCount" stackId="a">
                {hourly.map((entry, i) => (
                  <Cell key={i} fill={entry.downCount > 0 ? '#ef4444' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function UptimePage() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project') ?? ''

  const { data: alerts, isLoading } = useAlerts(projectId)
  const uptimeAlerts = alerts.filter((a) => a.type === 'uptime' && a.url)

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project to view uptime.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Uptime</h1>
          <p className="text-sm text-gray-500 mt-0.5">HTTP uptime checks run every 60 seconds</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : uptimeAlerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-14 text-center">
          <p className="text-sm font-medium text-gray-500">No uptime monitors configured</p>
          <p className="text-xs text-gray-400 mt-1">
            Go to{' '}
            <Link
              href={`/dashboard/alerts?project=${projectId}`}
              className="text-indigo-500 underline"
            >
              Alerts
            </Link>{' '}
            to add an uptime monitor
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {uptimeAlerts.map((alert) => (
            <UptimeCard key={alert.id} projectId={projectId} url={alert.url!} />
          ))}
        </div>
      )}
    </div>
  )
}
