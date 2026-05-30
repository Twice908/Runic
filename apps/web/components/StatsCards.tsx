'use client'

import { useStats } from '@/hooks/useStats'
import { formatResponseTime } from '@/lib/utils'

interface StatsCardsProps {
  projectId: string
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
      <div className="mt-4 h-8 w-20 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-3 w-32 animate-pulse rounded bg-gray-200" />
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  sub: string
  valueColor?: string
}

function StatCard({ label, value, sub, valueColor = 'text-gray-900 dark:text-slate-100' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${valueColor}`}>{value}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{sub}</p>
    </div>
  )
}

export default function StatsCards({ projectId }: StatsCardsProps) {
  const { data: stats, error } = useStats(projectId)

  if (error) {
    return (
      <p className="text-sm text-red-500">Failed to load stats. Please refresh.</p>
    )
  }

  if (!stats) {
    return (
      <div className="grid grid-cols-4 gap-6">
        {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const errorRateColor =
    stats.errorRate > 5 ? 'text-red-600' : stats.errorRate > 1 ? 'text-yellow-600' : 'text-gray-900 dark:text-slate-100'

  const avgRtColor =
    stats.avgResponseTime > 1000
      ? 'text-red-600'
      : stats.avgResponseTime > 500
        ? 'text-yellow-600'
        : 'text-gray-900 dark:text-slate-100'

  return (
    <div className="grid grid-cols-4 gap-6">
      <StatCard
        label="Requests (24h)"
        value={stats.requestsLast24h.toLocaleString()}
        sub={`${stats.totalRequests.toLocaleString()} total`}
      />
      <StatCard
        label="Error Rate (24h)"
        value={`${stats.errorRate.toFixed(1)}%`}
        sub={stats.errorRate > 5 ? 'Above 5% threshold' : 'Looking good'}
        valueColor={errorRateColor}
      />
      <StatCard
        label="Avg Response Time"
        value={formatResponseTime(stats.avgResponseTime)}
        sub={stats.avgResponseTime > 500 ? 'Slower than ideal' : 'Within target'}
        valueColor={avgRtColor}
      />
      <StatCard
        label="Active Errors"
        value={stats.activeErrors.toLocaleString()}
        sub="Distinct error types"
        valueColor={stats.activeErrors > 0 ? 'text-red-600' : 'text-gray-900 dark:text-slate-100'}
      />
    </div>
  )
}
