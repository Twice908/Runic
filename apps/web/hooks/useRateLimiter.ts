'use client'

import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { RateLimitRuleRecord, CreateRateLimitRuleBody } from '@pulse/types'

const RULES_STALE_TIME_MS = 30 * 1000
const RULES_QUERY_KEY = ['rate-limiter', 'rules'] as const

// ─── useRules ─────────────────────────────────────────────────────────────────

interface RulesResult {
  data: RateLimitRuleRecord[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useRules(projectId: string): RulesResult {
  const query = useQuery({
    queryKey: [...RULES_QUERY_KEY, projectId],
    queryFn: () =>
      apiFetch<{ data?: RateLimitRuleRecord[] }>(`/api/rate-limiter/${projectId}/rules`),
    enabled: Boolean(projectId),
    staleTime: RULES_STALE_TIME_MS,
  })

  return {
    data: query.data?.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

// ─── useRuleToggle ────────────────────────────────────────────────────────────

interface RuleToggleResult {
  toggle: (ruleId: string) => Promise<void>
  toggling: string | null
}

export function useRuleToggle(onSuccess: () => void): RuleToggleResult {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (ruleId: string) => {
      await fetch(`/api/rate-limiter/rules/${ruleId}/toggle`, { method: 'PUT' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY })
      onSuccess()
    },
  })

  const { mutateAsync } = mutation
  const toggle = useCallback(
    async (ruleId: string) => {
      await mutateAsync(ruleId)
    },
    [mutateAsync],
  )

  return { toggle, toggling: mutation.isPending ? mutation.variables ?? null : null }
}

// ─── useCreateRule ────────────────────────────────────────────────────────────

interface CreateRuleOutcome {
  ok: boolean
  isDuplicate: boolean
  error: string | null
}

interface CreateRuleResult {
  create: (body: CreateRateLimitRuleBody) => Promise<CreateRuleOutcome>
  creating: boolean
}

export function useCreateRule(projectId: string): CreateRuleResult {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (body: CreateRateLimitRuleBody): Promise<CreateRuleOutcome> => {
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
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: [...RULES_QUERY_KEY, projectId] })
      }
    },
  })

  const { mutateAsync } = mutation
  const create = useCallback(
    (body: CreateRateLimitRuleBody) => mutateAsync(body),
    [mutateAsync],
  )

  return { create, creating: mutation.isPending }
}
