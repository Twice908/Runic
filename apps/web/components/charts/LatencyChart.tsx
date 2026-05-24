'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { LatencyBucket } from '@pulse/types'

function formatLabel(bucket: string, range: string): string {
  const d = new Date(bucket)
  if (range === '7d') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface LatencyChartProps {
  data: LatencyBucket[]
  range: string
  isLoading: boolean
}

export default function LatencyChart({ data, range, isLoading }: LatencyChartProps) {
  if (isLoading) {
    return <div className="h-[300px] animate-pulse rounded-xl bg-gray-100" />
  }

  const rangeStartMs = range === '7d'
    ? Date.now() - 7 * 24 * 60 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000

  const chartData = (() => {
    const mapped = data.map((d) => ({
      bucket: formatLabel(d.bucket, range),
      p50: Math.round(d.p50),
      p90: Math.round(d.p90),
      p99: Math.round(d.p99),
    }))
    if (mapped.length < 2) {
      mapped.unshift({
        bucket: formatLabel(new Date(rangeStartMs).toISOString(), range),
        p50: 0,
        p90: 0,
        p99: 0,
      })
    }
    return mapped
  })()

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#e5e7eb" />
        <YAxis
          unit="ms"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          stroke="#e5e7eb"
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          formatter={(value) => [`${typeof value === 'number' ? value : 0} ms`]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="p50"
          name="P50"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="p90"
          name="P90"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="p99"
          name="P99"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
