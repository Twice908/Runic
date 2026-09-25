'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { relativeTime, formatResponseTime, statusCategory } from '@/lib/utils'
import type { RequestLogRow, LogsResponse } from '@runic/types'

interface LogTableProps {
  projectId: string
}

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700',
  POST: 'bg-green-100 text-green-700',
  PUT: 'bg-yellow-100 text-yellow-700',
  PATCH: 'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
}

const STATUS_STYLES: Record<string, string> = {
  '2xx': 'bg-green-100 text-green-700',
  '3xx': 'bg-blue-100 text-blue-700',
  '4xx': 'bg-orange-100 text-orange-700',
  '5xx': 'bg-red-100 text-red-700',
}

const RESPONSE_TIME_COLOR = (ms: number) => {
  if (ms > 1000) return 'text-red-600'
  if (ms > 200) return 'text-yellow-600'
  return 'text-green-600'
}

const STATUS_FILTERS = ['all', '2xx', '3xx', '4xx', '5xx'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function LogTable({ projectId }: LogTableProps) {
  const [logs, setLogs] = useState<RequestLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (statusFilter !== 'all') params.set('statusCategory', statusFilter)

    try {
      const data = await apiFetch<LogsResponse>(
        `/api/projects/${projectId}/logs?${params.toString()}`,
      )
      setLogs(data.logs)
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [projectId, page, statusFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  function handleFilterChange(f: StatusFilter) {
    setStatusFilter(f)
    setPage(1)
  }

  const start = (page - 1) * 50 + 1
  const end = Math.min(page * 50, total)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
      {/* Header + filter bar */}
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Request Logs</h2>
        <div className="flex gap-1 rounded-lg border border-gray-200 dark:border-slate-700 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={[
                'rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150',
                statusFilter === f
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-700">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Method
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Route
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Response Time
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                  No requests found.
                </td>
              </tr>
            )}
            {!loading &&
              logs.map((log) => {
                const cat = statusCategory(log.statusCode)
                return (
                  <tr
                    key={log.id}
                    className="border-b border-gray-100 dark:border-slate-700 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    <td className="px-6 py-3 text-gray-500 dark:text-slate-400 text-xs">
                      {relativeTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${METHOD_STYLES[log.method] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {log.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-800 dark:text-slate-100">{log.route}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[cat]}`}
                      >
                        {log.statusCode}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-xs ${RESPONSE_TIME_COLOR(log.responseTime)}`}
                    >
                      {formatResponseTime(log.responseTime)}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-700 px-6 py-3">
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Showing {start}–{end} of {total.toLocaleString()} requests
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors duration-150"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors duration-150"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
