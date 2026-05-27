'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useRules } from '@/hooks/useRateLimiter'
import { useHitRate, useTopOffenders } from '@/hooks/useRateLimitAnalytics'
import RateLimitHitRateChart from '@/components/charts/RateLimitHitRateChart'
import TimeRangeSelector, { type TimeRange } from '@/components/TimeRangeSelector'
import { relativeTime } from '@/lib/utils'

// ─── Skeleton card — mirrors StatsCards.tsx pattern exactly ──────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      <div className="mt-4 h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      <div className="mt-2 h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
    </div>
  )
}

// ─── Stat card — mirrors StatCard in StatsCards.tsx exactly ──────────────────

interface StatCardProps {
  label: string
  value: string
  sub: string
  valueColor?: string
}

function StatCard({ label, value, sub, valueColor = 'text-gray-900' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${valueColor} dark:text-slate-100`}>{value}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}

// ─── Overview stats fetcher ───────────────────────────────────────────────────

interface OverviewStats {
  totalRules: number
  enabledRules: number
  blockedLast24h: number
  loggedLast24h: number
}

function useOverviewStats(projectId: string) {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!projectId) { setIsLoading(false); return }
    setIsLoading(true)
    fetch(`/api/rate-limiter/${projectId}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: OverviewStats } | null) => {
        setStats(json?.data ?? null)
      })
      .catch(() => setStats(null))
      .finally(() => setIsLoading(false))
  }, [projectId])

  return { stats, isLoading }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RateLimiterOverviewPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = searchParams.get('project') ?? ''

  // ?rule=<ruleId> persists the selected rule across page refreshes and is shareable
  const selectedRuleId = searchParams.get('rule') ?? ''
  const range = (searchParams.get('range') as TimeRange) ?? '24h'

  const { data: rules, isLoading: rulesLoading } = useRules(projectId)
  const { stats, isLoading: statsLoading } = useOverviewStats(projectId)

  // Pass selectedRuleId (undefined = all rules) to both analytics hooks
  const ruleFilter = selectedRuleId || undefined
  const { data: hitRateData, isLoading: hitRateLoading } = useHitRate(projectId, range, ruleFilter)
  const { data: topOffenders, isLoading: offendersLoading } = useTopOffenders(
    projectId,
    range,
    10,
    ruleFilter,
  )

  // Use replace (not push) so rule selection doesn't pollute browser history
  const selectRule = useCallback(
    (ruleId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (ruleId) {
        params.set('rule', ruleId)
      } else {
        params.delete('rule')
      }
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )

  const setRange = useCallback(
    (r: TimeRange) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('range', r)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )

  function navigateTo(path: string) {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    router.push(`${path}?${params.toString()}`)
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project from the sidebar.</p>
      </div>
    )
  }

  // Derive summary counts directly from rules data (no extra API call needed)
  const totalRules = rules.length
  const enabledRules = rules.filter((r) => r.enabled).length

  const isLoading = rulesLoading || statsLoading

  // Show selector only when more than one rule exists
  const showRuleSelector = !rulesLoading && rules.length > 1

  return (
    <div className="max-w-7xl mx-auto p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Rate Limiter Overview</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Summary of rate limiting activity for this project</p>
        </div>
        <button
          onClick={() => navigateTo('/dashboard/rate-limiter/rules/new')}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Add Rule
        </button>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-6">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-6">
          <StatCard
            label="Total Rules"
            value={totalRules.toLocaleString()}
            sub={`${enabledRules} enabled`}
          />
          <StatCard
            label="Enabled Rules"
            value={enabledRules.toLocaleString()}
            sub={totalRules > 0 ? `${Math.round((enabledRules / totalRules) * 100)}% active` : 'No rules yet'}
          />
          <StatCard
            label="Blocked (24h)"
            value={stats?.blockedLast24h?.toLocaleString() ?? '—'}
            sub="Requests blocked"
            valueColor={stats && stats.blockedLast24h > 0 ? 'text-red-600' : 'text-gray-900'}
          />
          <StatCard
            label="Logged (24h)"
            value={stats?.loggedLast24h?.toLocaleString() ?? '—'}
            sub="Log-only events"
          />
        </div>
      )}

      {/* Quick nav tiles */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            title: 'Rules',
            desc: `${totalRules} rule${totalRules !== 1 ? 's' : ''} configured`,
            href: '/dashboard/rate-limiter/rules',
            cta: 'Manage rules →',
          },
          {
            title: 'Live Events',
            desc: 'Real-time feed of rate limit decisions',
            href: '/dashboard/rate-limiter/events',
            cta: 'View events →',
          },
          {
            title: 'Analytics',
            desc: 'Hit rate charts and top offenders',
            href: '/dashboard/rate-limiter',
            cta: 'View overview →',
          },
        ].map((tile) => (
          <button
            key={tile.href + tile.title}
            onClick={() => navigateTo(tile.href)}
            className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-5 text-left transition-colors hover:border-indigo-300 hover:shadow-md"
          >
            <p className="font-semibold text-sm text-gray-900 dark:text-slate-100">{tile.title}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{tile.desc}</p>
            <p className="text-xs mt-3 font-medium text-indigo-600">{tile.cta}</p>
          </button>
        ))}
      </div>

      {/* Top blocked IPs / keys (24h) */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Top Blocked IPs / Keys (24h)</h2>
        {offendersLoading ? (
          <div className="h-40 rounded-xl bg-gray-100 animate-pulse" />
        ) : topOffenders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No blocked requests in the last 24 hours</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-700">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Key</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Rule</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Blocks</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {topOffenders.map((offender, i) => (
                  <tr
                    key={`${offender.limitKey}-${offender.ruleId}`}
                    className={`border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 ${i === topOffenders.length - 1 ? 'border-b-0' : ''}`}
                  >
                    <td className="px-6 py-3 font-mono text-xs text-gray-800 dark:text-slate-100 max-w-[200px] truncate">{offender.limitKey}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-400">{offender.ruleName}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{offender.blockCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">{relativeTime(offender.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hit rate chart with per-rule selector */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Hit Rate ({range})</h2>

          <div className="flex items-center gap-3">
            {/* Rule selector — hidden when ≤ 1 rule */}
            {showRuleSelector && (
              <select
                value={selectedRuleId}
                onChange={(e) => selectRule(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-700 dark:text-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Rules</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            )}

            <TimeRangeSelector value={range} onChange={setRange} />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-4">
          {hitRateLoading ? (
            <div className="h-[300px] animate-pulse rounded-xl bg-gray-100" />
          ) : (
            <RateLimitHitRateChart data={hitRateData} range={range} isLoading={false} />
          )}
        </div>
      </section>
    </div>
  )
}
