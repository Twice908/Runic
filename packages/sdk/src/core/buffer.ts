import type { IngestEvent } from '../types'

const DEFAULT_FLUSH_INTERVAL_MS = 500
const DEFAULT_MAX_BATCH_SIZE = 10

interface BatchBufferConfig {
  flushInterval?: number
  maxBatchSize?: number
  onFlush: (events: IngestEvent[]) => Promise<void>
}

export class BatchBuffer {
  private readonly flushInterval: number
  private readonly maxBatchSize: number
  private readonly onFlush: (events: IngestEvent[]) => Promise<void>
  private buffer: IngestEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: BatchBufferConfig) {
    this.flushInterval = config.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.onFlush = config.onFlush
  }

  add(event: IngestEvent): void {
    this.buffer.push(event)
    if (this.buffer.length >= this.maxBatchSize) {
      // Flush immediately without waiting for the interval.
      this.flush().catch(() => undefined)
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer.splice(0, this.buffer.length)
    await this.onFlush(batch)
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      this.flush().catch(() => undefined)
    }, this.flushInterval)
    // Allow the process to exit without waiting for the interval.
    if (this.timer.unref) this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.flush()
  }
}
