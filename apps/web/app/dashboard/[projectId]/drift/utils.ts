import type { DriftCellStatus, DriftEventType } from './types'

export const CELL_LABELS: Record<DriftCellStatus, { glyph: string; label: string; classes: string }> = {
  present: { glyph: '✓', label: 'Present', classes: 'bg-green-50 text-green-700 border-green-200' },
  missing: { glyph: '✗', label: 'Missing', classes: 'bg-red-50 text-red-700 border-red-200' },
  extra: { glyph: '+', label: 'Extra', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  stale: { glyph: '⚠', label: 'Stale', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  ignored: { glyph: '–', label: 'Ignored', classes: 'bg-gray-50 text-gray-500 border-gray-200' },
}

export const EVENT_ICONS: Record<DriftEventType, { glyph: string; label: string; classes: string }> = {
  MISSING_KEY: { glyph: '✗', label: 'Missing key', classes: 'text-red-600 bg-red-50' },
  EXTRA_KEY: { glyph: '+', label: 'Extra key', classes: 'text-blue-600 bg-blue-50' },
  STALE_ROTATION: { glyph: '⚠', label: 'Stale rotation', classes: 'text-amber-600 bg-amber-50' },
  KEY_RESTORED: { glyph: '✓', label: 'Key restored', classes: 'text-green-600 bg-green-50' },
}

const SCORE_GREEN_MIN = 90
const SCORE_YELLOW_MIN = 70

export function scoreColorClasses(score: number): string {
  if (score >= SCORE_GREEN_MIN) return 'text-green-600'
  if (score >= SCORE_YELLOW_MIN) return 'text-amber-600'
  return 'text-red-600'
}

export function scoreBgClasses(score: number): string {
  if (score >= SCORE_GREEN_MIN) return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
  if (score >= SCORE_YELLOW_MIN) return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
  return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
}

const SECONDS_IN_MINUTE = 60
const SECONDS_IN_HOUR = 3600
const SECONDS_IN_DAY = 86400

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diff < SECONDS_IN_MINUTE) return `${diff} second${diff === 1 ? '' : 's'} ago`
  if (diff < SECONDS_IN_HOUR) {
    const m = Math.floor(diff / SECONDS_IN_MINUTE)
    return `${m} minute${m === 1 ? '' : 's'} ago`
  }
  if (diff < SECONDS_IN_DAY) {
    const h = Math.floor(diff / SECONDS_IN_HOUR)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  const d = Math.floor(diff / SECONDS_IN_DAY)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
