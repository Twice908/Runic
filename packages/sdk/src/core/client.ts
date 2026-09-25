import type { IngestEvent, RunicClientConfig } from '../types'

const DEFAULT_HOST = process.env['RUNIC_HOST'] ?? 'https://api.runic.dev'
const DEFAULT_TIMEOUT_MS = 5000

export class RunicClient {
  private readonly config: RunicClientConfig
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

    if (!config.host && !process.env['RUNIC_HOST']) {
      console.warn(
        '[Runic] RUNIC_HOST is not set — defaulting to https://api.runic.dev. ' +
        'Set RUNIC_HOST=http://localhost:3000 for local development.',
      )
    }
  }

  async send(events: IngestEvent[]): Promise<void> {
    if (events.length === 0) return

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      if (this.config.debug) {
        console.log(`[Runic] Sending ${events.length} event(s) to ${this.config.host}/ingest`)
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
        console.warn('[Runic] Invalid API key — check your apiKey config')
        return
      }
      if (res.status === 429) {
        console.warn('[Runic] Rate limit hit — reduce request volume or upgrade plan')
        return
      }
      if (res.status === 402) {
        console.warn('[Runic] Monthly request limit reached — upgrade your plan to continue sending data')
        return
      }
      if (!res.ok) {
        if (this.config.debug) {
          console.log(`[Runic] Non-200 response: ${res.status}`)
        }
        return
      }

      if (this.config.debug) {
        console.log(`[Runic] Successfully sent ${events.length} event(s)`)
      }
    } catch (err) {
      clearTimeout(timer)
      const message = err instanceof Error ? err.message : String(err)
      if (this.config.debug) {
        console.log(`[Runic] Send failed (events dropped): ${message}`)
      } else if (!this.hasPrintedSendError) {
        this.hasPrintedSendError = true
        console.warn(`[Runic] Failed to send events to ${this.config.host} — check RUNIC_HOST and RUNIC_API_KEY. (${message})`)
      }
      // Silently drop — never throw, never reject.
    }
  }
}
