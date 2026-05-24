import type { IngestEvent, PulseClientConfig } from '../types'

const DEFAULT_HOST = process.env['PULSE_HOST'] ?? 'https://api.pulse.dev'
const DEFAULT_TIMEOUT_MS = 5000

export class PulseClient {
  private readonly config: PulseClientConfig
  private hasPrintedSendError = false

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

    if (!config.host && !process.env['PULSE_HOST']) {
      console.warn(
        '[Pulse] PULSE_HOST is not set — defaulting to https://api.pulse.dev. ' +
        'Set PULSE_HOST=http://localhost:3000 for local development.',
      )
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
      const message = err instanceof Error ? err.message : String(err)
      if (this.config.debug) {
        console.log(`[Pulse] Send failed (events dropped): ${message}`)
      } else if (!this.hasPrintedSendError) {
        this.hasPrintedSendError = true
        console.warn(`[Pulse] Failed to send events to ${this.config.host} — check PULSE_HOST and PULSE_API_KEY. (${message})`)
      }
      // Silently drop — never throw, never reject.
    }
  }
}
