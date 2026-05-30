'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { AgentSpanRow } from '@/components/agents/SpanTable'

const AGENTS_STALE_TIME_MS = 15 * 1000
const AGENTS_REFETCH_INTERVAL_MS = 5 * 1000
const AGENTS_PAGE_SIZE = 20

export interface AgentRunSummary {
  id: string
  task: string
  status: string
  startedAt: string
  endedAt: string | null
  totalTokens: number | null
  totalCostUsd: number | null
  spanCount: number
}

export interface AgentRunsResponse {
  runs: AgentRunSummary[]
  total: number
  page: number
  hasMore: boolean
}

export interface AgentRunDetail {
  id: string
  task: string
  status: string
  startedAt: string
  endedAt: string | null
  totalTokens: number | null
  totalCostUsd: number | null
  metadata: unknown
}

export interface AgentRunDetailResponse {
  run: AgentRunDetail
  spans: AgentSpanRow[]
}

export interface AgentRunsFilters {
  status?: string
  page?: number
}

interface RunsResult {
  data: AgentRunsResponse | null
  isLoading: boolean
  error: string | null
}

interface RunDetailResult {
  data: AgentRunDetailResponse | null
  isLoading: boolean
  error: string | null
}

export function useAgentRuns(projectId: string, filters: AgentRunsFilters = {}): RunsResult {
  const { status = 'all', page = 1 } = filters

  const params = new URLSearchParams({
    project: projectId,
    page: String(page),
    limit: String(AGENTS_PAGE_SIZE),
  })
  if (status !== 'all') params.set('status', status)

  const query = useQuery({
    queryKey: ['agents', 'runs', projectId, status, page],
    queryFn: () => apiFetch<AgentRunsResponse>(`/api/agents/runs?${params.toString()}`),
    enabled: Boolean(projectId),
    staleTime: AGENTS_STALE_TIME_MS,
    refetchInterval: AGENTS_REFETCH_INTERVAL_MS,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}

export function useAgentRun(projectId: string, runId: string): RunDetailResult {
  const query = useQuery({
    queryKey: ['agents', 'run', projectId, runId],
    queryFn: () => apiFetch<AgentRunDetailResponse>(`/api/agents/runs/${runId}`),
    enabled: Boolean(runId),
    staleTime: AGENTS_STALE_TIME_MS,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}
