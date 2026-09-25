export type SpanType = 'llm_call' | 'tool_call' | 'memory_read' | 'agent_message' | 'error'

export type AgentSpanPayload = {
  type: 'span' | 'run_start' | 'run_end'
  runId: string
  spanId?: string
  parentSpanId?: string
  task?: string
  agentName?: string
  spanType?: SpanType
  name?: string
  model?: string
  startedAt: string
  endedAt?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  inputPreview?: string
  outputPreview?: string
  status?: 'success' | 'error' | 'timeout' | 'completed' | 'failed' | 'interrupted'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export type StartRunOpts = {
  metadata?: Record<string, unknown>
}

export type StartSpanOpts = {
  name: string
  model?: string
  agentName?: string
  inputPreview?: string
  parentSpanId?: string
  metadata?: Record<string, unknown>
}

export type EndSpanOpts = {
  outputPreview?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  status?: 'success' | 'error' | 'timeout'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export type CompleteRunOpts = {
  status?: 'completed' | 'failed' | 'interrupted'
  errorMessage?: string
  metadata?: Record<string, unknown>
}
