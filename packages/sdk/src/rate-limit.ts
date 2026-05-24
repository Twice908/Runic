// ─── Public types ─────────────────────────────────────────────────────────────

export interface RateLimitRule {
  path: string
  limit: number
  window: string   // e.g. '1m', '30s', '1h'
  key: 'ip' | 'apiKey' | 'userId' | 'global'
  action?: 'block' | 'log_only'
}

export interface LimitedContext {
  path: string
  key: string
  limit: number
  remaining: number
  resetAt: number
  retryAfter?: number
}

export interface RateLimitOptions {
  rules: 'auto' | RateLimitRule[]
  failOpen?: boolean           // MUST default to true — never false
  onLimited?: (ctx: LimitedContext) => void
  headerPrefix?: string        // default: 'X-RateLimit'
  checkTimeout?: number        // ms before /v1/check aborts and fails open (default: 100)
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface ApiRule {
  pathPattern: string
  limitKey: string
  limitCount: number
  windowSecs: number
  action: string
  enabled: boolean
}

export interface CheckMeta {
  id: string
  limit: number
  remaining: number
  resetAt: number
}

export interface CheckOutcome {
  allowed: boolean
  meta?: CheckMeta
  retryAfter?: number
}

export interface CheckContext {
  path: string
  method: string
  ip: string
  apiKey: string
  headers: Record<string, string>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000
const DEFAULT_CHECK_TIMEOUT_MS = 100
const FETCH_RULES_TIMEOUT_MS = 5_000

// ─── Minimal glob matcher (no extra dependencies) ────────────────────────────

function simpleGlobMatch(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex metacharacters
    .replace(/\*\*/g, '\x00')               // protect ** before handling *
    .replace(/\*/g, '[^/]*')               // * matches within a segment
    .replace(/\x00/g, '.*')               // ** matches across segments
    .replace(/\?/g, '[^/]')               // ? matches a single non-slash char
  try {
    return new RegExp(`^${regexStr}$`).test(path)
  } catch {
    return false
  }
}

// ─── Core class ───────────────────────────────────────────────────────────────

export class RateLimiter {
  private cachedRules: RateLimitRule[] = []
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  private readonly rlUrl: string | null
  private readonly projectId: string | null
  private readonly apiKey: string | null
  private readonly internalToken: string
  private readonly _failOpen: boolean
  private readonly _headerPrefix: string
  private readonly _checkTimeout: number
  readonly onLimited: ((ctx: LimitedContext) => void) | undefined

  constructor(options: RateLimitOptions) {
    this.rlUrl = (process.env['RATE_LIMITER_URL'] ?? '').replace(/\/$/, '') || null
    this.projectId = process.env['PULSE_PROJECT_ID'] ?? null
    this.apiKey = process.env['PULSE_API_KEY'] ?? null
    this.internalToken = process.env['RATE_LIMITER_INTERNAL_TOKEN'] ?? ''
    this._failOpen = options.failOpen ?? true
    this._headerPrefix = options.headerPrefix ?? 'X-RateLimit'
    this._checkTimeout = options.checkTimeout ?? DEFAULT_CHECK_TIMEOUT_MS
    this.onLimited = options.onLimited

    if (!this._failOpen) {
      // Warn loudly: setting failOpen to false means a Pulse outage blocks all
      // traffic on rate-limited paths in the developer's own backend.
      console.warn(
        '[Pulse] rateLimit: failOpen is set to false — any Pulse service outage will block user traffic on rate-limited paths',
      )
    }

    if (options.rules === 'auto') {
      this.fetchRules().catch(() => undefined)
      this.refreshTimer = setInterval(
        () => void this.fetchRules().catch(() => undefined),
        REFRESH_INTERVAL_MS,
      )
      if (this.refreshTimer.unref) this.refreshTimer.unref()
    } else {
      this.cachedRules = options.rules
    }
  }

  // ── Rule fetching ───────────────────────────────────────────────────────────

  private async fetchRules(): Promise<void> {
    if (!this.rlUrl || !this.projectId) return

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_RULES_TIMEOUT_MS)

    try {
      const res = await fetch(`${this.rlUrl}/v1/rules/${this.projectId}`, {
        headers: { Authorization: `Bearer ${this.internalToken}` },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) return
      const json = (await res.json()) as { data?: ApiRule[] }
      if (!Array.isArray(json.data)) return

      this.cachedRules = json.data
        .filter((r) => r.enabled)
        .map((r) => ({
          path: r.pathPattern,
          limit: r.limitCount,
          window: `${r.windowSecs}s`,
          key: r.limitKey as RateLimitRule['key'],
          action: r.action as RateLimitRule['action'],
        }))
    } catch {
      clearTimeout(timer)
      // Silently retain stale rules — never throw, never block traffic
    }
  }

  // ── Path pre-filter ─────────────────────────────────────────────────────────

  private matchesAnyRule(path: string): boolean {
    return this.cachedRules.some((r) => simpleGlobMatch(r.path, path))
  }

  // ── Core check ──────────────────────────────────────────────────────────────

  async check(ctx: CheckContext): Promise<CheckOutcome> {
    // No service URL configured → dev/test mode, allow all traffic silently
    if (!this.rlUrl) {
      return { allowed: true }
    }

    // Local pre-filter: if rules are loaded and none matches, skip the network call
    if (this.cachedRules.length > 0 && !this.matchesAnyRule(ctx.path)) {
      return { allowed: true }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this._checkTimeout)

    try {
      const res = await fetch(`${this.rlUrl}/v1/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: this.projectId ?? '',
          apiKey: this.apiKey ?? ctx.apiKey,
          path: ctx.path,
          method: ctx.method,
          ip: ctx.ip,
          headers: ctx.headers,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        console.warn(
          `[Pulse] rateLimit: /v1/check returned ${res.status} — ${this._failOpen ? 'failing open' : 'blocking traffic'}`,
        )
        return this._failOpen ? { allowed: true } : { allowed: false }
      }

      const json = (await res.json()) as {
        allowed: boolean
        rule?: CheckMeta
        retryAfter?: number
      }

      if (!json.allowed && this.onLimited && json.rule) {
        this.onLimited({
          path: ctx.path,
          key: ctx.ip,
          limit: json.rule.limit,
          remaining: json.rule.remaining,
          resetAt: json.rule.resetAt,
          retryAfter: json.retryAfter,
        })
      }

      return {
        allowed: json.allowed,
        meta: json.rule,
        retryAfter: json.retryAfter,
      }
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn(`[Pulse] rateLimit: check timed out (>${this._checkTimeout}ms) — failing open`)
      } else {
        console.error(
          `[Pulse] rateLimit: /v1/check unreachable — ${this._failOpen ? 'failing open' : 'blocking traffic'}`,
        )
      }
      return this._failOpen ? { allowed: true } : { allowed: false }
    }
  }

  // ── Accessors for adapters ──────────────────────────────────────────────────

  get prefix(): string {
    return this._headerPrefix
  }

  get failOpen(): boolean {
    return this._failOpen
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }
}
