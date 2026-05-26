'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface KeyRow {
  keyName: string
  description: string | null
  owner: string | null
  rotationDays: number | null
  isIgnored: boolean
  ignoreReason: string | null
  daysOverdue: number | null
  firstSeenAt?: string | null
  lastChangedAt?: string | null
}

interface KeyEdits {
  owner?: string
  description?: string
  rotationDays?: number | null
  isIgnored?: boolean
  ignoreReason?: string
}

interface KeysPageProps {
  params: { projectId: string }
}

export default function KeysPage({ params }: KeysPageProps) {
  const projectId = params.projectId
  const [rows, setRows] = useState<KeyRow[]>([])
  const [edits, setEdits] = useState<Record<string, KeyEdits>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [savedAt, setSavedAt] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/drift/keys/${projectId}`, { cache: 'no-store' })
      if (!res.ok) {
        setError('Failed to load keys')
        return
      }
      const data = await res.json()
      console.log('fetched rows:', data)
      setRows(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err) {
      console.log('fetch error:', err)
      setError('Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    console.log('keys page mounted, projectId:', projectId)
    void load()
  }, [load])

  const setEdit = (keyName: string, patch: KeyEdits) => {
    setEdits((prev) => ({ ...prev, [keyName]: { ...prev[keyName], ...patch } }))
  }

  const dirty = (keyName: string) => Object.keys(edits[keyName] ?? {}).length > 0

  const save = async (row: KeyRow) => {
    const patch = edits[row.keyName]
    if (!patch || Object.keys(patch).length === 0) return
    setSaving((s) => ({ ...s, [row.keyName]: true }))
    setRows((prev) =>
      prev.map((r) => (r.keyName === row.keyName ? { ...r, ...patch } as KeyRow : r)),
    )
    try {
      const res = await fetch(
        `/api/drift/keys/${projectId}/${encodeURIComponent(row.keyName)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      if (!res.ok) {
        setError(`Failed to save ${row.keyName}`)
        await load()
        return
      }
      setEdits((prev) => {
        const next = { ...prev }
        delete next[row.keyName]
        return next
      })
      setSavedAt((s) => ({ ...s, [row.keyName]: Date.now() }))
    } catch {
      setError(`Failed to save ${row.keyName}`)
      await load()
    } finally {
      setSaving((s) => ({ ...s, [row.keyName]: false }))
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.keyName.localeCompare(b.keyName)),
    [rows],
  )

  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Keys</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Add ownership, descriptions, and rotation policy. Ignored keys are excluded from drift detection.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading keys…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No keys yet. Send a snapshot from the agent to populate this list.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 w-56">Key</th>
                <th className="text-left px-4 py-2 w-40">Owner</th>
                <th className="text-left px-4 py-2">Description</th>
                <th className="text-left px-4 py-2 w-24">Rotation</th>
                <th className="text-left px-4 py-2 w-32">Status</th>
                <th className="text-left px-4 py-2 w-40">Ignored</th>
                <th className="text-right px-4 py-2 w-24">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((row) => {
                const merged = { ...row, ...(edits[row.keyName] ?? {}) } as KeyRow
                const isDirty = dirty(row.keyName)
                const justSaved =
                  savedAt[row.keyName] && Date.now() - savedAt[row.keyName] < 2000
                return (
                  <tr key={row.keyName} className="align-middle">
                    <td className="px-4 py-2 font-mono text-xs text-gray-900">{row.keyName}</td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={merged.owner ?? ''}
                        onChange={(e) => setEdit(row.keyName, { owner: e.target.value })}
                        placeholder="—"
                        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={merged.description ?? ''}
                        onChange={(e) => setEdit(row.keyName, { description: e.target.value })}
                        placeholder="—"
                        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        value={merged.rotationDays ?? ''}
                        onChange={(e) =>
                          setEdit(row.keyName, {
                            rotationDays: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder="—"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <RotationBadge daysOverdue={row.daysOverdue} />
                    </td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={merged.isIgnored ?? false}
                          onChange={(e) =>
                            setEdit(row.keyName, { isIgnored: e.target.checked })
                          }
                          className="rounded border-gray-300"
                        />
                        Ignore
                      </label>
                      {merged.isIgnored && (
                        <input
                          type="text"
                          value={merged.ignoreReason ?? ''}
                          onChange={(e) =>
                            setEdit(row.keyName, { ignoreReason: e.target.value })
                          }
                          placeholder="reason"
                          className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                        />
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        disabled={!isDirty || saving[row.keyName]}
                        onClick={() => save(row)}
                        className={`rounded-md px-3 py-1 text-xs font-medium ${
                          isDirty
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                            : justSaved
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {saving[row.keyName] ? 'Saving…' : justSaved && !isDirty ? 'Saved' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function RotationBadge({ daysOverdue }: { daysOverdue: number | null }) {
  if (daysOverdue === null || daysOverdue === undefined) return <span className="text-xs text-gray-400">—</span>
  if (daysOverdue === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        current
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
      {daysOverdue} days overdue
    </span>
  )
}
