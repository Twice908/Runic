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
import ChartTooltip from './ChartTooltip'

function formatLabel(bucket: string, range: string): string {
  const d = new Date(bucket)
  if (range === '7d') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface RateLimitHitRateChartProps {
  data: HitRateBucket[]
  range: string
  isLoading: boolean
}

export default function RateLimitHitRateChart({ data, range, isLoading }: RateLimitHitRateChartProps) {
  if (isLoading) {
    return <div className="h-[300px] animate-pulse rounded-xl bg-gray-100" />
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

  const chartData = (() => {
    const mapped = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, counts]) => ({
        bucket: formatLabel(bucket, range),
        allowed: counts.allowed,
        blocked: counts.blocked,
      }))
    // Mirror VolumeChart — insert a zero baseline at the range start when sparse
    if (mapped.length < 2) {
      const rangeStartMs = Date.now() - (RANGE_MS[range] ?? RANGE_MS['24h']!)
      mapped.unshift({
        bucket: formatLabel(new Date(rangeStartMs).toISOString(), range),
        allowed: 0,
        blocked: 0,
      })
    }
    return mapped
  })()

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
          content={<ChartTooltip valueFormatter={(v, name) => `${v.toLocaleString()} ${name === 'allowed' ? 'allowed' : 'blocked'}`} />}
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
