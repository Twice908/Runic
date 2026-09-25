'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { VolumeBucket } from '@runic/types'
import ChartTooltip from './ChartTooltip'

function formatLabel(bucket: string, range: string): string {
  const d = new Date(bucket)
  if (range === '7d') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface ErrorRateChartProps {
  data: VolumeBucket[]
  range: string
  isLoading: boolean
}

export default function ErrorRateChart({ data, range, isLoading }: ErrorRateChartProps) {
  if (isLoading) {
    return <div className="h-[300px] animate-runic rounded-xl bg-gray-100" />
  }

  const rangeStartMs = range === '7d'
    ? Date.now() - 7 * 24 * 60 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000

  const chartData = (() => {
    const mapped = data.map((d) => ({
      bucket: formatLabel(d.bucket, range),
      errorRate: d.count > 0 ? parseFloat(((d.errorCount / d.count) * 100).toFixed(2)) : 0,
    }))
    if (mapped.length < 2) {
      mapped.unshift({
        bucket: formatLabel(new Date(rangeStartMs).toISOString(), range),
        errorRate: 0,
      })
    }
    return mapped
  })()

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          {/* Gradient runs top→bottom: high error rate (top) = red, low (bottom) = green */}
          <linearGradient id="errorRateGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#9ca3af' }} stroke="#e5e7eb" />
        <YAxis
          domain={[0, 100]}
          unit="%"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          stroke="#e5e7eb"
        />
        <Tooltip
          content={<ChartTooltip valueFormatter={(v) => `${v}%`} />}
        />
        <Area
          type="monotone"
          dataKey="errorRate"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#errorRateGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
