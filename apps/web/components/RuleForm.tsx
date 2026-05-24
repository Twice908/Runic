'use client'

import { useState } from 'react'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────

export const ruleFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  pathPattern: z.string().min(1, 'Path pattern is required'),
  limitKey: z.enum(['ip', 'apiKey', 'userId', 'global']),
  limitCount: z.number({ invalid_type_error: 'Limit must be a number' }).int().positive('Must be a positive integer'),
  windowSecs: z.number({ invalid_type_error: 'Window must be a number' }).int().positive('Must be a positive integer'),
  action: z.enum(['block', 'log_only']),
})

export type RuleFormValues = z.infer<typeof ruleFormSchema>

type FormErrors = Partial<Record<keyof RuleFormValues | 'duplicate' | 'general', string>>

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const WINDOW_PRESETS = [
  { label: '10 seconds', value: 10 },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '1 hour', value: 3600 },
]

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-600">{msg}</p>
}

const INPUT_BASE =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const INPUT_ERROR =
  'w-full rounded-lg border border-red-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RuleFormProps {
  initialValues?: Partial<RuleFormValues>
  onValidSubmit: (data: RuleFormValues) => Promise<{ isDuplicate?: boolean; error?: string } | void>
  onCancel: () => void
  submitLabel?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RuleForm({ initialValues, onValidSubmit, onCancel, submitLabel = 'Save' }: RuleFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '')
  const [pathPattern, setPathPattern] = useState(initialValues?.pathPattern ?? '')
  const [limitKey, setLimitKey] = useState<RuleFormValues['limitKey']>(initialValues?.limitKey ?? 'ip')
  const [limitCount, setLimitCount] = useState(initialValues?.limitCount != null ? String(initialValues.limitCount) : '')
  const [windowSecs, setWindowSecs] = useState(
    initialValues?.windowSecs != null ? String(initialValues.windowSecs) : '60',
  )
  const [action, setAction] = useState<RuleFormValues['action']>(initialValues?.action ?? 'block')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})

    const parsed = ruleFormSchema.safeParse({
      name,
      pathPattern,
      limitKey,
      limitCount: parseInt(limitCount, 10),
      windowSecs: parseInt(windowSecs, 10),
      action,
    })

    if (!parsed.success) {
      const fieldErrors: FormErrors = {}
      parsed.error.errors.forEach((err) => {
        const key = err.path[0] as keyof RuleFormValues
        if (key) fieldErrors[key] = err.message
      })
      setErrors(fieldErrors)
      return
    }

    setSubmitting(true)
    try {
      const result = await onValidSubmit(parsed.data)
      if (result?.isDuplicate) {
        setErrors({ duplicate: 'A rule with this path pattern and limit key already exists for this project.' })
      } else if (result?.error) {
        setErrors({ general: result.error })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {errors.duplicate && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-medium text-red-700">Duplicate rule</p>
          <p className="text-xs text-red-600 mt-0.5">{errors.duplicate}</p>
        </div>
      )}
      {errors.general && <p className="text-xs text-red-600">{errors.general}</p>}

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Rule name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          placeholder="Login rate limit"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={errors.name ? INPUT_ERROR : INPUT_BASE}
        />
        <FieldError msg={errors.name} />
      </div>

      {/* Path pattern */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Path pattern (glob) <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          placeholder="/api/auth/*"
          value={pathPattern}
          onChange={(e) => setPathPattern(e.target.value)}
          className={`${errors.pathPattern ? INPUT_ERROR : INPUT_BASE} font-mono`}
        />
        <p className="mt-1 text-xs text-gray-400">
          Supports glob syntax:{' '}
          <code className="font-mono bg-gray-100 px-1 rounded">/api/**</code>,{' '}
          <code className="font-mono bg-gray-100 px-1 rounded">/api/auth/*</code>
        </p>
        <FieldError msg={errors.pathPattern} />
      </div>

      {/* Limit + window */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Request limit <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            placeholder="100"
            value={limitCount}
            onChange={(e) => setLimitCount(e.target.value)}
            className={errors.limitCount ? INPUT_ERROR : INPUT_BASE}
          />
          <FieldError msg={errors.limitCount} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Time window <span className="text-red-500">*</span>
          </label>
          <select
            value={windowSecs}
            onChange={(e) => setWindowSecs(e.target.value)}
            className={errors.windowSecs ? INPUT_ERROR : INPUT_BASE}
          >
            {/* Include current value if not a standard preset */}
            {!WINDOW_PRESETS.some((p) => String(p.value) === windowSecs) && (
              <option value={windowSecs}>{windowSecs}s (current)</option>
            )}
            {WINDOW_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <FieldError msg={errors.windowSecs} />
        </div>
      </div>

      {/* Limit key */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Rate limit key <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {(['ip', 'apiKey', 'userId', 'global'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setLimitKey(k)}
              className={[
                'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                limitKey === k
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-indigo-300',
              ].join(' ')}
            >
              {k === 'ip' ? 'IP Address' : k === 'apiKey' ? 'API Key' : k === 'userId' ? 'User ID' : 'Global'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          {limitKey === 'ip' && 'One counter per client IP address'}
          {limitKey === 'apiKey' && 'One counter per API key'}
          {limitKey === 'userId' && 'One counter per user ID (X-User-Id header)'}
          {limitKey === 'global' && 'Single shared counter across all callers'}
        </p>
      </div>

      {/* Action */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Action when limit is reached <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-3">
          {([
            { value: 'block', label: 'Block (429)', desc: 'Return 429 Too Many Requests' },
            { value: 'log_only', label: 'Log only', desc: 'Allow but record the event' },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAction(opt.value)}
              className={[
                'flex-1 rounded-lg border p-3 text-left transition-colors',
                action === opt.value
                  ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                  : 'border-gray-200 bg-white hover:border-indigo-300',
              ].join(' ')}
            >
              <p className="text-sm font-medium text-gray-800">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-between pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
