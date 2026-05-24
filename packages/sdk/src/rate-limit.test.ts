import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from './rate-limit'

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_ENV = {
  RATE_LIMITER_URL: 'http://localhost:3002',
  PULSE_PROJECT_ID: 'proj_test',
  PULSE_API_KEY: 'pk_test_123',
  RATE_LIMITER_INTERNAL_TOKEN: 'internal_secret',
}

function stubEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  const merged = { ...BASE_ENV, ...overrides }
  for (const [k, v] of Object.entries(merged)) {
    vi.stubEnv(k, v)
  }
}

const CHECK_CTX = {
  path: '/api/login',
  method: 'POST',
  ip: '1.2.3.4',
  apiKey: 'pk_test_123',
  headers: {},
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── Test 1: fail open when Pulse returns 5xx ────────────────────────────────

  it('fails open when /v1/check returns 5xx', async () => {
    stubEnv()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    )

    const limiter = new RateLimiter({ rules: 'auto', failOpen: true })
    // cachedRules is empty → pre-filter is skipped → check fires
    const outcome = await limiter.check(CHECK_CTX)

    expect(outcome.allowed).toBe(true)

    limiter.destroy()
  })

  // ── Test 2: rules fetched on startup and refreshed every 30s ───────────────

  it('fetches rules on startup and refreshes every 30 seconds', async () => {
    stubEnv()
    vi.useFakeTimers()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              pathPattern: '/api/login',
              limitKey: 'ip',
              limitCount: 10,
              windowSecs: 60,
              action: 'block',
              enabled: true,
            },
          ],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const limiter = new RateLimiter({ rules: 'auto' })

    // Flush pending promises from the initial fetchRules() call.
    // advanceTimersByTimeAsync(0) advances by 0ms (no interval fires) but
    // drains the promise queue — available in vitest >= 1.4.0.
    await vi.advanceTimersByTimeAsync(0)

    // One startup fetch must have fired for /v1/rules
    const rulesCalls = mockFetch.mock.calls.filter((args) =>
      (args[0] as string).includes('/v1/rules'),
    )
    expect(rulesCalls).toHaveLength(1)

    // Advance 30 seconds — setInterval should fire exactly once more
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    const rulesCallsAfter = mockFetch.mock.calls.filter((args) =>
      (args[0] as string).includes('/v1/rules'),
    )
    expect(rulesCallsAfter).toHaveLength(2)

    limiter.destroy()
  })

  // ── Test 3: manual rules — no call to /v1/rules ─────────────────────────────

  it('does not call /v1/rules when rules are passed manually', async () => {
    stubEnv()

    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const limiter = new RateLimiter({
      rules: [{ path: '/api/login', limit: 5, window: '1m', key: 'ip' }],
    })

    // No network call should have been made to /v1/rules
    const rulesCalls = mockFetch.mock.calls.filter((args) =>
      (args[0] as string).includes('/v1/rules'),
    )
    expect(rulesCalls).toHaveLength(0)

    limiter.destroy()
  })

  // ── Test 4: failOpen: false blocks traffic when Pulse is unreachable ────────

  it('blocks traffic and warns when failOpen is false and Pulse is unreachable', async () => {
    stubEnv()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Constructor warns about failOpen: false
    const limiter = new RateLimiter({ rules: 'auto', failOpen: false })

    // cachedRules is empty → check fires → fetch rejects → failOpen is false → blocked
    const outcome = await limiter.check(CHECK_CTX)

    expect(outcome.allowed).toBe(false)

    // console.warn must have been called about failOpen: false (from constructor)
    const warnMessages = [
      ...warnSpy.mock.calls.map((args) => args.join(' ')),
      ...errorSpy.mock.calls.map((args) => args.join(' ')),
    ]
    expect(warnMessages.some((m) => m.includes('failOpen'))).toBe(true)

    limiter.destroy()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

// Re-export the constant so it is visible inside the test file without
// reaching into the module's private scope.
const REFRESH_INTERVAL_MS = 30_000
