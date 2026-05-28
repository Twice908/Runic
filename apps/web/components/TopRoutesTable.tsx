'use client'

import { useState } from 'react'
import type { TopRoute } from '@pulse/types'

type SortKey = 'requestCount' | 'errorRate' | 'avgLatency' | 'p99Latency'

function errorRateColor(rate: number): string {
  if (rate > 5) return 'text-red-600 bg-red-50'
  if (rate >= 1) return 'text-amber-600 bg-amber-50'
  return 'text-green-600 bg-green-50'
}

function latencyColor(ms: number): string {
  if (ms > 500) return 'text-red-600'
  if (ms >= 200) return 'text-amber-600'
  return 'text-green-600'
}

interface TopRoutesTableProps {
  data: TopRoute[]
  isLoading: boolean
}

export default function TopRoutesTable({ data, isLoading }: TopRoutesTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('requestCount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    const mul = sortDir === 'desc' ? -1 : 1
    return (a[sortKey] - b[sortKey]) * mul
  })

  const headers: { key: SortKey; label: string }[] = [
    { key: 'requestCount', label: 'Requests' },
    { key: 'errorRate', label: 'Error Rate' },
    { key: 'avgLatency', label: 'Avg Latency' },
    { key: 'p99Latency', label: 'P99 Latency' },
  ]

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
        No route data for this time range
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <table className="min-w-full divide-y divide-gray-100 dark:divide-slate-700 text-sm">
        <thead className="bg-gray-50 dark:bg-slate-700">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Route
            </th>
            {headers.map((h) => (
              <th
                key={h.key}
                className="cursor-pointer select-none px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                onClick={() => toggleSort(h.key)}
              >
                {h.label}{' '}
                <span className="text-gray-300 dark:text-slate-500">
                  {sortKey === h.key ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-slate-800">
          {sorted.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-100 dark:bg-slate-600 px-1.5 py-0.5 font-mono text-xs font-medium text-gray-600 dark:text-slate-200">
                    {row.method}
                  </span>
                  <span className="font-mono text-xs text-gray-800 dark:text-slate-100 truncate max-w-xs">
                    {row.route}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-gray-700 dark:text-slate-400">
                {row.requestCount.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${errorRateColor(row.errorRate)}`}>
                  {row.errorRate.toFixed(1)}%
                </span>
              </td>
              <td className={`px-4 py-3 text-right font-mono text-xs font-medium ${latencyColor(row.avgLatency)}`}>
                {Math.round(row.avgLatency)}ms
              </td>
              <td className={`px-4 py-3 text-right font-mono text-xs font-medium ${latencyColor(row.p99Latency)}`}>
                {Math.round(row.p99Latency)}ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
