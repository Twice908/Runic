export type PlanType = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export type AlertType = 'error_rate' | 'latency' | 'uptime'

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
