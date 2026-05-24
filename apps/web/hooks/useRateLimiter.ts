'use client'

import { useState, useEffect, useCallback } from 'react'
import type { RateLimitRuleRecord, CreateRateLimitRuleBody } from '@pulse/types'

// ─── useRules ─────────────────────────────────────────────────────────────────

interface RulesResult {
  data: RateLimitRuleRecord[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useRules(projectId: string): RulesResult {
  const [data, setData] = useState<RateLimitRuleRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false)
      return
    }
    // Pause fetching when the tab is hidden
    if (document.visibilityState === 'hidden') return

    setIsLoading(true)
    try {
      const res = await fetch(`/api/rate-limiter/${projectId}/rules`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data?: RateLimitRuleRecord[] }
      setData(json.data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch rules')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

// ─── useRuleToggle ────────────────────────────────────────────────────────────

interface RuleToggleResult {
  toggle: (ruleId: string) => Promise<void>
  toggling: string | null
}

export function useRuleToggle(onSuccess: () => void): RuleToggleResult {
  const [toggling, setToggling] = useState<string | null>(null)

  const toggle = useCallback(
    async (ruleId: string) => {
      setToggling(ruleId)
      try {
        await fetch(`/api/rate-limiter/rules/${ruleId}/toggle`, { method: 'PUT' })
        onSuccess()
      } finally {
        setToggling(null)
      }
    },
    [onSuccess],
  )

  return { toggle, toggling }
}

// ─── useCreateRule ────────────────────────────────────────────────────────────

interface CreateRuleResult {
  create: (body: CreateRateLimitRuleBody) => Promise<{ ok: boolean; isDuplicate: boolean; error: string | null }>
  creating: boolean
}

export function useCreateRule(projectId: string): CreateRuleResult {
  const [creating, setCreating] = useState(false)

  const create = useCallback(
    async (body: CreateRateLimitRuleBody) => {
      setCreating(true)
      try {
        const res = await fetch(`/api/rate-limiter/${projectId}/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as { error?: { code?: string; message?: string } }
        if (!res.ok) {
          return {
            ok: false,
            isDuplicate: json.error?.code === 'DUPLICATE_RULE' || res.status === 409,
            error: json.error?.message ?? `HTTP ${res.status}`,
          }
        }
        return { ok: true, isDuplicate: false, error: null }
      } catch (e) {
        return {
          ok: false,
          isDuplicate: false,
          error: e instanceof Error ? e.message : 'Failed to create rule',
        }
      } finally {
        setCreating(false)
      }
    },
    [projectId],
  )

  return { create, creating }
}
