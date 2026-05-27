'use client'

import { useState } from 'react'
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
import type { UptimeCheck, AlertRule, AlertChannel } from '@pulse/types'

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
  alert: AlertRule
  onDisable: (alertId: string) => void
  onEdit: (alert: AlertRule) => void
  disabling: string | null
}

function UptimeCard({ projectId, alert, onDisable, onEdit, disabling }: UptimeCardProps) {
  const { data, isLoading, error } = useUptime(projectId)
  const hourly = bucketByHour(data.checks)

  if (isLoading) return <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot status={data.current} />
          <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{alert.url}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              data.current === 'up' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {data.current.toUpperCase()}
          </span>
          <button
            onClick={() => onEdit(alert)}
            className="text-xs text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-slate-300 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDisable(alert.id)}
            disabled={disabling === alert.id}
            className="text-xs text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            {disabling === alert.id ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider font-medium">Uptime (24h)</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{data.uptimePercent24h.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider font-medium">Avg Response</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">
            {data.avgResponseTime24h > 0 ? `${data.avgResponseTime24h}ms` : '—'}
          </p>
        </div>
      </div>

      {/* Timeline chart */}
      {data.checks.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">Last 24h (hourly)</p>
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={hourly} barSize={6} barCategoryGap="20%">
              <XAxis dataKey="hour" tick={false} axisLine={false} tickLine={false} />
              <YAxis hide />
                      <Tooltip
                formatter={(value, name) => [value, name === 'upCount' ? 'Up checks' : 'Down checks']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="upCount" stackId="a" fill="#22c55e" />
              <Bar dataKey="downCount" stackId="a" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── add / edit form ───────────────────────────────────────────────────────────

interface UptimeFormProps {
  projectId: string
  initial?: AlertRule
  onSaved: () => void
  onCancel: () => void
}

function UptimeForm({ projectId, initial, onSaved, onCancel }: UptimeFormProps) {
  const [url, setUrl] = useState(initial?.url ?? '')
  const [channel, setChannel] = useState<AlertChannel>(initial?.channel ?? 'email')
  const [destination, setDestination] = useState(initial?.destination ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      let res: Response
      if (initial) {
        res = await fetch(`/api/projects/${projectId}/alerts/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, destination }),
        })
      } else {
        res = await fetch(`/api/projects/${projectId}/alerts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'uptime', channel, destination, threshold: 0, url }),
        })
      }
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } }
        throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const INPUT = 'w-full rounded-lg border border-gray-300 dark:border-slate-500 bg-white dark:bg-slate-600 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-slate-600 bg-indigo-50/40 dark:bg-slate-700 p-6 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">{initial ? 'Edit monitor' : 'Add URL to monitor'}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">URL</label>
          <input
            type="url"
            placeholder="https://api.example.com/health"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className={INPUT}
          />
        </div>

        {!initial && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Notification channel</label>
              <div className="flex gap-2">
                {(['email', 'slack'] as AlertChannel[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setChannel(c); setDestination('') }}
                    className={[
                      'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                      channel === c ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 dark:border-slate-500 bg-white dark:bg-slate-600 text-gray-600 dark:text-slate-200 hover:border-indigo-300',
                    ].join(' ')}
                  >
                    {c === 'email' ? 'Email' : 'Slack'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
                {channel === 'email' ? 'Email address' : 'Slack webhook URL'}
              </label>
              <input
                type={channel === 'email' ? 'email' : 'url'}
                placeholder={channel === 'email' ? 'you@example.com' : 'https://hooks.slack.com/services/...'}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                required
                className={INPUT}
              />
            </div>
          </>
        )}

        {initial && (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Notification destination</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className={INPUT}
            />
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-between">
          <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? 'Saving…' : initial ? 'Save Changes' : 'Add Monitor'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function UptimePage() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project') ?? ''

  const { data: alerts, isLoading, refetch } = useAlerts(projectId)
  const uptimeAlerts = alerts.filter((a) => a.type === 'uptime' && a.url && a.active)

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingAlert, setEditingAlert] = useState<AlertRule | null>(null)
  const [disabling, setDisabling] = useState<string | null>(null)

  async function handleDisable(alertId: string) {
    setDisabling(alertId)
    await fetch(`/api/projects/${projectId}/alerts/${alertId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    })
    setDisabling(null)
    refetch()
  }

  function handleSaved() {
    setShowAddForm(false)
    setEditingAlert(null)
    refetch()
  }

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
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Uptime</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">HTTP uptime checks run every 60 seconds</p>
        </div>
        {!showAddForm && !editingAlert && (
          <button
            onClick={() => setShowAddForm(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Add URL to monitor
          </button>
        )}
      </div>

      {showAddForm && (
        <UptimeForm
          projectId={projectId}
          onSaved={handleSaved}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {editingAlert && (
        <UptimeForm
          projectId={projectId}
          initial={editingAlert}
          onSaved={handleSaved}
          onCancel={() => setEditingAlert(null)}
        />
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : uptimeAlerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-14 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-slate-400">No uptime monitors configured</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Click "Add URL to monitor" above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {uptimeAlerts.map((alert) => (
            <UptimeCard
              key={alert.id}
              projectId={projectId}
              alert={alert}
              onDisable={handleDisable}
              onEdit={setEditingAlert}
              disabling={disabling}
            />
          ))}
        </div>
      )}
    </div>
  )
}
