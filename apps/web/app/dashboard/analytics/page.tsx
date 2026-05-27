'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import TimeRangeSelector, { type TimeRange } from '@/components/TimeRangeSelector'
import VolumeChart from '@/components/charts/VolumeChart'
import LatencyChart from '@/components/charts/LatencyChart'
import ErrorRateChart from '@/components/charts/ErrorRateChart'
import TopRoutesTable from '@/components/TopRoutesTable'
import { useVolumeData, useLatencyData, useTopRoutes } from '@/hooks/useAnalytics'

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700 dark:text-slate-100">{title}</h3>
      <div className="dark:[&_.recharts-wrapper]:bg-slate-800 dark:[&_.recharts-surface]:bg-slate-800">
        {children}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const projectId = searchParams.get('project') ?? ''
  const range = (searchParams.get('range') as TimeRange) ?? '24h'

  function setRange(r: TimeRange) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', r)
    router.replace(`${pathname}?${params.toString()}`)
  }

  const { data: volumeData, isLoading: volumeLoading } = useVolumeData(projectId, range)
  const { data: latencyData, isLoading: latencyLoading } = useLatencyData(projectId, range)
  const { data: topRoutes, isLoading: topLoading } = useTopRoutes(projectId, range)

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project to view analytics.</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Analytics</h1>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {/* Row 1 — Request Volume */}
      <ChartCard title="Request Volume">
        <VolumeChart data={volumeData} range={range} isLoading={volumeLoading} />
      </ChartCard>

      {/* Row 2 — Latency + Error Rate */}
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3">
          <ChartCard title="Latency Percentiles">
            <LatencyChart data={latencyData} range={range} isLoading={latencyLoading} />
          </ChartCard>
        </div>
        <div className="col-span-2">
          <ChartCard title="Error Rate">
            <ErrorRateChart data={volumeData} range={range} isLoading={volumeLoading} />
          </ChartCard>
        </div>
      </div>

      {/* Row 3 — Top Routes */}
      <ChartCard title="Top Routes">
        <TopRoutesTable data={topRoutes} isLoading={topLoading} />
      </ChartCard>
    </div>
  )
}
