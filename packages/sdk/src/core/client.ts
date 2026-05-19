import type { IngestEvent, PulseClientConfig } from '../types'

const DEFAULT_HOST = process.env['PULSE_HOST'] ?? 'https://api.pulse.dev'
const DEFAULT_TIMEOUT_MS = 5000

export class PulseClient {
  private readonly config: PulseClientConfig

  constructor(config: {
    apiKey: string
    host?: string
    timeout?: number
    debug?: boolean
  }) {
    this.config = {
      apiKey: config.apiKey,
      host: (config.host ?? DEFAULT_HOST).replace(/\/$/, ''),
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      debug: config.debug ?? false,
    }
  }

  async send(events: IngestEvent[]): Promise<void> {
    if (events.length === 0) return

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      if (this.config.debug) {
        console.log(`[Pulse] Sending ${events.length} event(s) to ${this.config.host}/ingest`)
      }

      const res = await fetch(`${this.config.host}/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (res.status === 401) {
        console.warn('[Pulse] Invalid API key — check your apiKey config')
        return
      }
      if (res.status === 429) {
        console.warn('[Pulse] Rate limit hit — reduce request volume or upgrade plan')
        return
      }
      if (res.status === 402) {
        console.warn('[Pulse] Monthly request limit reached — upgrade your plan to continue sending data')
        return
      }
      if (!res.ok) {
        if (this.config.debug) {
          console.log(`[Pulse] Non-200 response: ${res.status}`)
        }
        return
      }

      if (this.config.debug) {
        console.log(`[Pulse] Successfully sent ${events.length} event(s)`)
      }
    } catch (err) {
      clearTimeout(timer)
      if (this.config.debug) {
        const message = err instanceof Error ? err.message : String(err)
        console.log(`[Pulse] Send failed (events dropped): ${message}`)
      }
      // Silently drop — never throw, never reject.
    }
  }
}
