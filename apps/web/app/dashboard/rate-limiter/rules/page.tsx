'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useRules, useRuleToggle } from '@/hooks/useRateLimiter'
import RuleForm, { type RuleFormValues } from '@/components/RuleForm'
import type { RateLimitRuleRecord } from '@pulse/types'

// ─── helpers ──────────────────────────────────────────────────────────────────

function windowLabel(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${secs / 60}m`
  return `${secs / 3600}h`
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  rule: RateLimitRuleRecord
  onClose: () => void
  onSaved: () => void
}

function EditModal({ rule, onClose, onSaved }: EditModalProps) {
  async function handleSubmit(data: RuleFormValues) {
    const res = await fetch(`/api/rate-limiter/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = (await res.json()) as { error?: { code?: string; message?: string } }
    if (!res.ok) {
      return {
        isDuplicate: json.error?.code === 'DUPLICATE_RULE' || res.status === 409,
        error: json.error?.message ?? `HTTP ${res.status}`,
      }
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl mx-4">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Edit Rule</h2>
          <p className="mt-0.5 text-sm text-gray-500">Changes go live within 30 seconds.</p>
        </div>
        <div className="px-6 py-5">
          <RuleForm
            initialValues={{
              name: rule.name,
              pathPattern: rule.pathPattern,
              limitKey: rule.limitKey,
              limitCount: rule.limitCount,
              windowSecs: rule.windowSecs,
              action: rule.action,
            }}
            onValidSubmit={handleSubmit}
            onCancel={onClose}
            submitLabel="Save Changes"
          />
        </div>
      </div>
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

interface RuleRowProps {
  rule: RateLimitRuleRecord
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (rule: RateLimitRuleRecord) => void
  toggling: string | null
  deleting: string | null
}

function RuleRow({ rule, onToggle, onDelete, onEdit, toggling, deleting }: RuleRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const actionBadge = rule.action === 'block'
    ? 'bg-red-100 text-red-700'
    : 'bg-yellow-100 text-yellow-700'
  const keyBadge: Record<string, string> = {
    ip: 'bg-blue-100 text-blue-700',
    apiKey: 'bg-purple-100 text-purple-700',
    userId: 'bg-indigo-100 text-indigo-700',
    global: 'bg-gray-100 text-gray-700',
  }

  return (
    <tr className="border-b border-gray-100 transition-colors duration-150 hover:bg-gray-50">
      {/* Name */}
      <td className="px-6 py-3 text-sm font-medium text-gray-900">{rule.name}</td>

      {/* Path pattern */}
      <td className="px-4 py-3 font-mono text-sm text-gray-700">{rule.pathPattern}</td>

      {/* Limit */}
      <td className="px-4 py-3 text-sm text-gray-700">
        {rule.limitCount.toLocaleString()} / {windowLabel(rule.windowSecs)}
      </td>

      {/* Key type */}
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${keyBadge[rule.limitKey] ?? 'bg-gray-100 text-gray-700'}`}>
          {rule.limitKey}
        </span>
      </td>

      {/* Action */}
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${actionBadge}`}>
          {rule.action === 'block' ? 'Block' : 'Log only'}
        </span>
      </td>

      {/* Status toggle */}
      <td className="px-4 py-3">
        <button
          onClick={() => onToggle(rule.id)}
          disabled={toggling === rule.id}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50"
          style={{ backgroundColor: rule.enabled ? '#4f46e5' : '#d1d5db' }}
          title={rule.enabled ? 'Disable rule' : 'Enable rule'}
        >
          <span
            className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
            style={{ transform: rule.enabled ? 'translateX(18px)' : 'translateX(2px)' }}
          />
        </button>
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2">
            <button
              onClick={() => onDelete(rule.id)}
              disabled={deleting === rule.id}
              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {deleting === rule.id ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-3">
            <button
              onClick={() => onEdit(rule)}
              className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Delete
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <tr key={i} className="border-b border-gray-100">
          {[1, 2, 3, 4, 5, 6, 7].map((j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function RateLimiterRulesPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = searchParams.get('project') ?? ''

  const { data: rules, isLoading, error, refetch } = useRules(projectId)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<RateLimitRuleRecord | null>(null)

  const handleRefetch = useCallback(() => refetch(), [refetch])
  const { toggle, toggling } = useRuleToggle(handleRefetch)

  async function handleDelete(ruleId: string) {
    setDeleting(ruleId)
    await fetch(`/api/rate-limiter/rules/${ruleId}`, { method: 'DELETE' })
    setDeleting(null)
    refetch()
  }

  function handleEditSaved() {
    setEditingRule(null)
    refetch()
    const params = new URLSearchParams(searchParams.toString())
    params.set('updated', '1')
    params.delete('created')
    router.replace(`/dashboard/rate-limiter/rules?${params.toString()}`)
  }

  function navigateToNew() {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    router.push(`/dashboard/rate-limiter/rules/new?${params.toString()}`)
  }

  function navigateToOverview() {
    const params = new URLSearchParams()
    if (projectId) params.set('project', projectId)
    router.push(`/dashboard/rate-limiter?${params.toString()}`)
  }

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Select a project from the sidebar.</p>
      </div>
    )
  }

  const justCreated = searchParams.get('created') === '1'
  const justUpdated = searchParams.get('updated') === '1'

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Success banners */}
      {justCreated && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2">
          <span className="text-green-600 text-sm font-medium">Rule created successfully.</span>
          <span className="text-green-500 text-xs">It will be live within 30 seconds.</span>
        </div>
      )}
      {justUpdated && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2">
          <span className="text-green-600 text-sm font-medium">Rule updated successfully.</span>
          <span className="text-green-500 text-xs">Changes will be live within 30 seconds.</span>
        </div>
      )}

      <button
        onClick={navigateToOverview}
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to overview
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Rate Limit Rules</h1>
          <p className="text-sm text-gray-500 mt-0.5">Protect your API endpoints from abuse</p>
        </div>
        <button
          onClick={navigateToNew}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Add Rule
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-500">Failed to load rules: {error}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Path Pattern</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Limit</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Key Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows />
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="text-sm font-medium text-gray-500">No rate limit rules yet</p>
                    <p className="text-xs text-gray-400 mt-1">
                      <button
                        onClick={navigateToNew}
                        className="text-indigo-600 hover:text-indigo-800 underline"
                      >
                        Create your first rule
                      </button>{' '}
                      to start protecting your endpoints
                    </p>
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={toggle}
                    onDelete={handleDelete}
                    onEdit={setEditingRule}
                    toggling={toggling}
                    deleting={deleting}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingRule && (
        <EditModal
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  )
}
