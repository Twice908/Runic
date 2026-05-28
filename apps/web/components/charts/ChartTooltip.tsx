'use client'

import type { TooltipProps } from 'recharts'

type ChartTooltipProps = TooltipProps<number, string> & {
  labelFormatter?: (label: string) => string
  valueFormatter?: (value: number, name: string) => string
}

export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  const displayLabel = labelFormatter ? labelFormatter(String(label)) : String(label)

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 shadow-md text-xs">
      {displayLabel && (
        <p className="mb-1 font-medium text-gray-500 dark:text-slate-400">{displayLabel}</p>
      )}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-900 dark:text-slate-100">
            {entry.name}:{' '}
            <span className="font-medium">
              {valueFormatter
                ? valueFormatter(entry.value as number, entry.name as string)
                : String(entry.value)}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
