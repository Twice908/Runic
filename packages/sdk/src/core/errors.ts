import type { PulseClient } from './client'
import type { IngestEvent } from '../types'

// Module-level reference set by the middleware on first initialization.
let _client: PulseClient | null = null

export function setClient(client: PulseClient): void {
  _client = client
}

export function captureError(
  error: Error,
  context?: { route?: string; method?: string },
): void {
  if (!_client) {
    console.warn('[Pulse] captureError called before pulse() middleware was initialized — event dropped')
    return
  }

  const event: IngestEvent = {
    method: context?.method ?? 'UNKNOWN',
    route: context?.route ?? '/unknown',
    statusCode: 500,
    responseTime: 0,
    timestamp: new Date().toISOString(),
  }

  // Send immediately, bypassing the buffer — background jobs have no HTTP lifecycle.
  _client.send([event]).catch(() => undefined)
}
