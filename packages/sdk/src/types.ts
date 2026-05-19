export interface PulseConfig {
  apiKey: string
  host?: string
  timeout?: number
  debug?: boolean
  ignoreRoutes?: string[]
  ignoreMethods?: string[]
  captureBody?: boolean
  captureHeaders?: boolean
}

// Matches the exact shape accepted by POST /ingest on the Fastify API.
// statusCode must be an integer 100–599, responseTime an integer >= 0.
export interface IngestEvent {
  method: string
  route: string
  statusCode: number
  responseTime: number
  timestamp: string // ISO 8601
}

export interface PulseClientConfig {
  apiKey: string
  host: string
  timeout: number
  debug: boolean
}
