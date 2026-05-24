export type PlanType = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export type AlertType = 'error_rate' | 'response_time' | 'uptime' | 'rate_limit_spike'

export type AlertChannel = 'email' | 'slack'

export interface IngestEvent {
  method: string
  route: string
  statusCode: number
  responseTime: number
  timestamp: string
  stack?: string
}

export interface IngestPayload {
  events: IngestEvent[]
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}

export interface ApiSuccessResponse<T = unknown> {
  success: true
  data?: T
}

export interface RequestLogRow {
  id: string
  projectId: string
  method: string
  route: string
  statusCode: number
  responseTime: number
  timestamp: string
}

export interface ProjectSummary {
  id: string
  name: string
  apiKeyPrefix: string
  createdAt: string
}

export interface ProjectStats {
  totalRequests: number
  requestsLast24h: number
  errorRate: number
  avgResponseTime: number
  activeErrors: number
}

export interface LogsResponse {
  logs: RequestLogRow[]
  total: number
  page: number
  hasMore: boolean
}

export interface CreateProjectResponse {
  projectId: string
  name: string
  apiKey: string
  apiKeyPrefix: string
}

export interface RegenerateKeyResponse {
  projectId: string
  apiKey: string
  apiKeyPrefix: string
}

export interface VolumeBucket {
  bucket: string
  count: number
  errorCount: number
}

export interface LatencyBucket {
  bucket: string
  p50: number
  p90: number
  p99: number
}

export interface TopRoute {
  route: string
  method: string
  requestCount: number
  errorRate: number
  avgLatency: number
  p99Latency: number
}

export interface ErrorGroup {
  id: string
  message: string
  route: string
  statusCode: number
  count: number
  firstSeen: string
  lastSeen: string
  stack?: string
  resolved: boolean
  resolvedAt?: string | null
}

export interface AlertRule {
  id: string
  type: AlertType
  channel: AlertChannel
  destination: string
  threshold: number
  url?: string
  route?: string
  active: boolean
  lastFired?: string
}

export interface AlertHistoryEntry {
  id: string
  alertId: string
  type: string
  triggeredValue: number
  threshold: number
  message: string
  channel: string
  sentAt: string
}

export interface UptimeCheck {
  status: 'up' | 'down'
  responseTime: number
  checkedAt: string
  httpStatusCode: number
}

export interface UptimeStatus {
  current: 'up' | 'down'
  uptimePercent24h: number
  avgResponseTime24h: number
  checks: UptimeCheck[]
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export type RateLimitKeyType = 'ip' | 'apiKey' | 'userId' | 'global'

export type RateLimitAction = 'block' | 'log_only'

export type RateLimitEventAction = 'blocked' | 'logged'

export interface RateLimitRuleRecord {
  id: string
  projectId: string
  name: string
  pathPattern: string
  limitKey: RateLimitKeyType
  limitKeyHeader?: string | null
  limitCount: number
  windowSecs: number
  action: RateLimitAction
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RateLimitEventRecord {
  id: string
  projectId: string
  ruleId: string
  limitKey: string
  path: string
  action: RateLimitEventAction
  timestamp: string
}

export interface CheckRequest {
  projectId: string
  apiKey: string
  path: string
  method: string
  ip: string
  headers: Record<string, string>
}

export interface RateLimitMeta {
  id: string
  limit: number
  remaining: number
  resetAt: number
}

export interface CheckResponseAllowed {
  allowed: true
  rule: RateLimitMeta
}

export interface CheckResponseDenied {
  allowed: false
  rule: RateLimitMeta
  retryAfter: number
}

export type CheckResponse = CheckResponseAllowed | CheckResponseDenied

export interface CreateRateLimitRuleBody {
  name: string
  pathPattern: string
  limitKey: RateLimitKeyType
  limitKeyHeader?: string
  limitCount: number
  windowSecs: number
  action: RateLimitAction
  priority?: number
}

export interface UpdateRateLimitRuleBody {
  name?: string
  pathPattern?: string
  limitKey?: RateLimitKeyType
  limitKeyHeader?: string | null
  limitCount?: number
  windowSecs?: number
  action?: RateLimitAction
  priority?: number
  enabled?: boolean
}
