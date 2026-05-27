'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DriftCellStatus, DriftMatrixResponse, DriftMatrixRow } from '../types'
import { CELL_LABELS, relativeTime } from '../utils'

type StatusFilter = 'all' | DriftCellStatus

interface CellSelection {
  row: DriftMatrixRow
  envName: string
  status: DriftCellStatus
}

interface MatrixViewProps {
  projectId: string
  matrix: DriftMatrixResponse
}

interface KeyHistoryEvent {
  id: string
  driftType: string
  detectedAt: string
  resolvedAt: string | null
  environmentName: string
}

function buildCsv(matrix: DriftMatrixResponse, rows: DriftMatrixRow[]): string {
  const header = ['key', ...matrix.environments.map((e) => e.name)]
  const lines = [header.join(',')]
  for (const row of rows) {
    const cells = matrix.environments.map((env) => row.cells[env.name] ?? 'missing')
    lines.push([row.keyName, ...cells].join(','))
  }
  return lines.join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function MatrixView({ projectId, matrix }: MatrixViewProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<CellSelection | null>(null)

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matrix.rows.filter((row) => {
      if (q && !row.keyName.toLowerCase().includes(q)) return false
      if (statusFilter !== 'all') {
        const has = matrix.environments.some((env) => row.cells[env.name] === statusFilter)
        if (!has) return false
      }
      return true
    })
  }, [matrix, search, statusFilter])

  function exportCsv() {
    const csv = buildCsv(matrix, filteredRows)
    downloadCsv(`drift-matrix-${projectId}-${Date.now()}.csv`, csv)
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
        <input
          type="text"
          placeholder="Search keys…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-slate-100 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All statuses</option>
          <option value="missing">Missing</option>
          <option value="extra">Extra</option>
          <option value="stale">Stale</option>
          <option value="ignored">Ignored</option>
        </select>
        <button
          onClick={exportCsv}
          className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 dark:text-slate-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>

      {/* Matrix table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-auto max-h-[70vh]">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-gray-50 dark:bg-slate-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-400 border-b border-r border-gray-200 dark:border-slate-600">
                Key
              </th>
              {matrix.environments.map((env) => (
                <th
                  key={env.id}
                  className="sticky top-0 z-20 bg-gray-50 dark:bg-slate-700 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600"
                >
                  <div className="flex flex-col items-center">
                    <span>{env.name}</span>
                    {env.isBaseline && (
                      <span className="mt-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 normal-case">
                        baseline
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={matrix.environments.length + 1}
                  className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400"
                >
                  No keys match your filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.keyName} className="hover:bg-gray-50/60 dark:hover:bg-slate-700/50">
                  <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-4 py-2 font-mono text-xs text-gray-800 dark:text-slate-100 border-b border-r border-gray-100 dark:border-slate-700 whitespace-nowrap">
                    {row.keyName}
                  </td>
                  {matrix.environments.map((env) => {
                    const status = row.cells[env.name] ?? 'missing'
                    const meta = CELL_LABELS[status]
                    return (
                      <td
                        key={env.id}
                        className="border-b border-gray-100 dark:border-slate-700 px-2 py-1 text-center"
                      >
                        <button
                          onClick={() => setSelected({ row, envName: env.name, status })}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded border text-sm font-semibold ${meta.classes}`}
                          title={`${meta.label} in ${env.name}`}
                          aria-label={`${row.keyName} ${meta.label} in ${env.name}`}
                        >
                          {meta.glyph}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <CellDrawer
          projectId={projectId}
          selection={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function CellDrawer({
  projectId,
  selection,
  onClose,
}: {
  projectId: string
  selection: CellSelection
  onClose: () => void
}) {
  const [history, setHistory] = useState<KeyHistoryEvent[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setHistory(null)
    fetch(`/api/drift/events/${projectId}?keyName=${encodeURIComponent(selection.row.keyName)}&limit=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { events?: KeyHistoryEvent[] } } | null) => {
        setHistory(json?.data?.events ?? [])
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [projectId, selection.row.keyName])

  const meta = CELL_LABELS[selection.status]

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-slate-800 shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-5 py-4">
          <h2 className="font-mono text-sm font-semibold text-gray-900 dark:text-slate-100">
            {selection.row.keyName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">Environment</p>
              <p className="mt-1 text-gray-900 dark:text-slate-100">{selection.envName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">Status</p>
              <p className="mt-1">
                <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${meta.classes}`}>
                  {meta.glyph} {meta.label}
                </span>
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">First seen</p>
              <p className="mt-1 text-gray-900 dark:text-slate-100">{relativeTime(selection.row.firstSeenAt ?? null)}</p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">Drift history</p>
            {loading ? (
              <div className="h-20 rounded-lg bg-gray-100 animate-pulse" />
            ) : history && history.length > 0 ? (
              <ul className="space-y-2">
                {history.map((ev) => (
                  <li
                    key={ev.id}
                    className="rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700 dark:text-slate-300">{ev.driftType}</span>
                      <span className="text-gray-500 dark:text-slate-400">{relativeTime(ev.detectedAt)}</span>
                    </div>
                    <p className="mt-0.5 text-gray-500 dark:text-slate-400">in {ev.environmentName}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500 dark:text-slate-400">No prior drift events for this key.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
