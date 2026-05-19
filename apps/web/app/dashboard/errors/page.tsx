'use client'

import { useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import TimeRangeSelector, { type TimeRange } from '@/components/TimeRangeSelector'
import { useErrorList } from '@/hooks/useAnalytics'
import type { ErrorGroup } from '@pulse/types'

const STATUS_COLORS: Record<number, string> = {}
function statusBadgeColor(code: number): string {
  if (code >= 500) return 'bg-red-100 text-red-700'
  if (code >= 400) return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-600'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ErrorCard({ error }: { error: ErrorGroup }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">
              {error.message.slice(0, 120)}{error.message.length > 120 ? '…' : ''}
            </p>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
              <span className={`rounded-full px-2 py-0.5 font-medium ${statusBadgeColor(error.statusCode)}`}>
                {error.statusCode}
              </span>
              <span className="font-mono text-gray-600">{error.route}</span>
            </div>
          </div>
          <div className="flex-shrink-0 text-right text-xs text-gray-400">
            <p className="font-medium text-gray-700">{error.count.toLocaleString()}×</p>
            <p className="mt-0.5">last {relativeTime(error.lastSeen)}</p>
            {error.stack && (
              <p className="mt-1 text-indigo-500">{expanded ? 'hide' : 'details'}</p>
            )}
          </div>
        </div>
      </button>

      {expanded && error.stack && (
        <div className="border-t border-gray-100 px-5 py-4">
          <pre className="overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs leading-relaxed text-gray-300">
            {error.stack}
          </pre>
        </div>
      )}
    </div>
  )
}

export default function ErrorsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const projectId = searchParams.get('project') ?? ''
  const range = (searchParams.get('range') as TimeRange) ?? '24h'

  function setRange(r: TimeRange) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', r)
    router.replace(`${pathname}?${params.toString()}`)
  }

  const { data: errors, isLoading } = useErrorList(projectId, range)

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project to view errors.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Errors</h1>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {errors.length === 0 ? 'No errors' : `${errors.length} error group${errors.length === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {!isLoading && errors.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-600">No errors in this time range</p>
          <p className="mt-1 text-xs text-gray-400">Nice work!</p>
        </div>
      )}

      {!isLoading && errors.length > 0 && (
        <div className="space-y-3">
          {errors.map((e) => (
            <ErrorCard key={e.id} error={e} />
          ))}
        </div>
      )}
    </div>
  )
}
