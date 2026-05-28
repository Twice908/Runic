'use client'

import { useCallback, useEffect, useState } from 'react'
import BackButton from '../BackButton'
import type { DriftEnvironmentSummary } from '../types'
import { relativeTime, scoreBgClasses, scoreColorClasses } from '../utils'

export default function DriftEnvironmentsPage({
  params,
}: {
  params: { projectId: string }
}) {
  const projectId = params.projectId

  const [environments, setEnvironments] = useState<DriftEnvironmentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingEnv, setPendingEnv] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/drift/matrix/${projectId}`).catch(() => null)
    if (!res || !res.ok) {
      setLoading(false)
      return
    }
    const json = await res.json()
    const envs: DriftEnvironmentSummary[] = json?.data?.environments ?? json?.environments ?? []
    setEnvironments(envs)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function setBaseline(envName: string) {
    setPendingEnv(envName)
    setError(null)
    try {
      const res = await fetch(`/api/drift/baseline/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: envName }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? 'Failed to set baseline')
      } else {
        await load()
      }
    } catch {
      setError('Network error while setting baseline')
    } finally {
      setPendingEnv(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <BackButton />
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Environments</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Drift scores and baseline selection</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500 dark:text-slate-400">Loading environments…</div>
        ) : environments.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500 dark:text-slate-400">
            No environments yet. Send a snapshot from the agent to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-700">
            {environments.map((env) => (
              <li key={env.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-700">
                <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg border ${scoreBgClasses(env.driftScore)}`}>
                  <span className={`text-sm font-semibold ${scoreColorClasses(env.driftScore)}`}>
                    {env.driftScore}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-gray-900 dark:text-slate-100">{env.name}</p>
                    {env.isBaseline && (
                      <span className="rounded bg-indigo-100 dark:bg-indigo-900/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
                        baseline
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Last snapshot: {relativeTime(env.lastSeenAt)}
                  </p>
                </div>
                {!env.isBaseline && (
                  <button
                    onClick={() => setBaseline(env.name)}
                    disabled={pendingEnv === env.name}
                    className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-transparent px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    {pendingEnv === env.name ? 'Setting…' : 'Set as baseline'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
