'use client'

export type TimeRange = '1h' | '6h' | '24h' | '7d'
const RANGES: TimeRange[] = ['1h', '6h', '24h', '7d']

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={[
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150',
            r === value
              ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
              : 'text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          {r}
        </button>
      ))}
    </div>
  )
}
