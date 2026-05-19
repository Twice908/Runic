export type PlanType = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export type AlertType = 'error_rate' | 'response_time' | 'uptime'

export type AlertChannel = 'email' | 'slack'

export interface IngestEvent {
  method: string
  route: string
  statusCode: number
  responseTime: number
  timestamp: string
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
