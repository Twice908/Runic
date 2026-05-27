'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import RuleForm, { type RuleFormValues } from '@/components/RuleForm'
import { useCreateRule } from '@/hooks/useRateLimiter'

export default function NewRulePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = searchParams.get('project') ?? ''

  const { create } = useCreateRule(projectId)

  function rulesHref() {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    return `/dashboard/rate-limiter/rules?${params.toString()}`
  }

  async function handleSubmit(data: RuleFormValues) {
    const result = await create(data)
    if (result.ok) {
      const params = new URLSearchParams()
      if (projectId) params.set('project', projectId)
      params.set('created', '1')
      router.push(`/dashboard/rate-limiter/rules?${params.toString()}`)
      return
    }
    return { isDuplicate: result.isDuplicate, error: result.error ?? undefined }
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project from the sidebar.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-6">
        <button
          onClick={() => router.push(rulesHref())}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-flex items-center gap-1"
        >
          ← Back to rules
        </button>
        <h1 className="text-xl font-semibold text-gray-900">New Rate Limit Rule</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Rules are applied in priority order. Changes go live within 30 seconds.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
        <RuleForm
          onValidSubmit={handleSubmit}
          onCancel={() => router.push(rulesHref())}
          submitLabel="Create Rule"
        />
      </div>
    </div>
  )
}
