'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { HitRateBucket } from '@/hooks/useRateLimitAnalytics'

function formatLabel(bucket: string): string {
  const d = new Date(bucket)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface RateLimitHitRateChartProps {
  data: HitRateBucket[]
  isLoading: boolean
}

export default function RateLimitHitRateChart({ data, isLoading }: RateLimitHitRateChartProps) {
  if (isLoading) {
    return <div className="h-[300px] animate-pulse rounded-xl bg-gray-100" />
  }
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
        No rate limit events in this time range
      </div>
    )
  }

  // Aggregate across all rules into time-bucketed totals
  const bucketMap = new Map<string, { allowed: number; blocked: number }>()
  for (const row of data) {
    const existing = bucketMap.get(row.bucket) ?? { allowed: 0, blocked: 0 }
    bucketMap.set(row.bucket, {
      allowed: existing.allowed + row.allowed,
      blocked: existing.blocked + row.blocked,
    })
  }

  const chartData = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, counts]) => ({
      bucket: formatLabel(bucket),
      allowed: counts.allowed,
      blocked: counts.blocked,
    }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rlAllowed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="rlBlocked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#e5e7eb" />
        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#e5e7eb" />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          formatter={(value, name) => [
            typeof value === 'number' ? value.toLocaleString() : String(value),
            name === 'allowed' ? 'Allowed' : 'Blocked',
          ]}
        />
        <Legend
          formatter={(value) => (value === 'allowed' ? 'Allowed' : 'Blocked')}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="allowed"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#rlAllowed)"
        />
        <Area
          type="monotone"
          dataKey="blocked"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#rlBlocked)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
