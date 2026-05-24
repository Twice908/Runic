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
import type { VolumeBucket } from '@pulse/types'

function formatLabel(bucket: string, range: string): string {
  const d = new Date(bucket)
  if (range === '7d') return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (range === '24h') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface VolumeChartProps {
  data: VolumeBucket[]
  range: string
  isLoading: boolean
}

export default function VolumeChart({ data, range, isLoading }: VolumeChartProps) {
  if (isLoading) {
    return <div className="h-[300px] animate-pulse rounded-xl bg-gray-100" />
  }

  const rangeStartMs = range === '7d'
    ? Date.now() - 7 * 24 * 60 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000

  const chartData = (() => {
    const mapped = data.map((d) => ({
      bucket: formatLabel(d.bucket, range),
      count: d.count,
      errorCount: d.errorCount,
    }))
    if (mapped.length < 2) {
      mapped.unshift({
        bucket: formatLabel(new Date(rangeStartMs).toISOString(), range),
        count: 0,
        errorCount: 0,
      })
    }
    return mapped
  })()

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="volTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="volErrors" x1="0" y1="0" x2="0" y2="1">
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
            name === 'count' ? 'Requests' : 'Errors',
          ]}
        />
        <Legend
          formatter={(value) => (value === 'count' ? 'Requests' : 'Errors')}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#volTotal)"
        />
        <Area
          type="monotone"
          dataKey="errorCount"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#volErrors)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
