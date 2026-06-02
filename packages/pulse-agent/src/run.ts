import { AgentSpan } from './span'
import type { AgentSpanPayload, CompleteRunOpts, SpanType, StartSpanOpts } from './types'

const AUTO_FLUSH_MS = 30_000

export class AgentRun {
  readonly id: string
  private readonly runId: string
  private readonly startedAt: Date
  private readonly flushFn: (payloads: AgentSpanPayload[]) => void
  private readonly disabled: boolean
  private buffer: AgentSpanPayload[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private completed = false

  constructor(
    runId: string,
    startedAt: Date,
    flushFn: (payloads: AgentSpanPayload[]) => void,
    disabled = false,
  ) {
    this.id = runId
    this.runId = runId
    this.startedAt = startedAt
    this.flushFn = flushFn
    this.disabled = disabled

    if (!disabled) {
      this.flushTimer = setTimeout(() => {
        if (!this.completed) {
          // Auto-flush buffered spans WITHOUT finalizing the run.
          // Emitting run_end here would close the run server-side and
          // cause spans that end after the timer to be dropped.
          this._doFlush(false)
        }
      }, AUTO_FLUSH_MS)
    }
  }

  startSpan(spanType: SpanType, opts: StartSpanOpts): AgentSpan {
    if (this.disabled) return AgentSpan.noop()

    const spanId = crypto.randomUUID()
    const startedAt = new Date()
    return new AgentSpan(spanId, this.runId, startedAt, spanType, opts, (payload) => {
      this.buffer.push(payload)
    })
  }

  async complete(opts: CompleteRunOpts = {}): Promise<void> {
    if (this.disabled || this.completed) return
    this.completed = true

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    this._doFlush(true, opts)
  }

  private _doFlush(isFinal: boolean, opts: CompleteRunOpts = {}): void {
    const payloads: AgentSpanPayload[] = [...this.buffer]

    if (isFinal) {
      // Final flush: clear the buffer and append run_end.
      // complete() re-sends ALL buffered spans (including any the timer
      // already sent) so the worker can deduplicate by spanId.
      this.buffer = []
      payloads.push({
        type: 'run_end',
        runId: this.runId,
        startedAt: this.startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: opts.status,
        errorMessage: opts.errorMessage,
        metadata: opts.metadata,
      })
    }
    // Timer flush (isFinal=false): do NOT clear this.buffer.
    // Spans added after the timer still accumulate and will be
    // included in the final flush when complete() is called.

    if (payloads.length === 0) return

    this.flushFn(payloads)
  }

  static noop(): AgentRun {
    return new AgentRun('', new Date(), () => {}, true)
  }
}
