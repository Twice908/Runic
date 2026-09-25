import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import IORedisMock from 'ioredis-mock'
import Fastify from 'fastify'
import { checkRoutes } from './check'
import type { RateLimitRuleRecord } from '@runic/types'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../plugins/redis', async () => {
  const { default: IORedisMock } = await import('ioredis-mock')
  return { redis: new IORedisMock() }
})

vi.mock('../plugins/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    rateLimitRule: { findMany: vi.fn() },
  },
}))

vi.mock('../lib/queue', () => ({
  rateLimitEventQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

// checkTimeoutMs=200 gives enough room for mocked async calls without needing real waits
vi.mock('../env', () => ({
  ruleCacheTtl: 30,
  checkTimeoutMs: 200,
  env: {
    RATE_LIMITER_INTERNAL_TOKEN: 'test-token',
    RATE_LIMITER_PORT: '3002',
    NODE_ENV: 'test',
  },
  redisUrl: 'redis://localhost:6379',
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false })
  app.setErrorHandler((err, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({
      success: false,
      error: { code: err.code ?? 'ERR', message: err.message },
    })
  })
  await app.register(checkRoutes, { prefix: '/v1' })
  return app
}

function checkPayload(
  overrides: Partial<{
    projectId: string
    apiKey: string
    path: string
    method: string
    ip: string
    headers: Record<string, string>
  }> = {},
) {
  return {
    projectId: 'proj_test',
    apiKey: 'pk_live_testkey123456789012345678901234567890',
    path: '/api/login',
    method: 'POST',
    ip: '10.0.0.1',
    headers: {},
    ...overrides,
  }
}

const FAKE_RULE: RateLimitRuleRecord = {
  id: 'rule_1',
  projectId: 'proj_test',
  name: 'Login limit',
  pathPattern: '/api/login',
  limitKey: 'ip',
  limitKeyHeader: null,
  limitCount: 3,
  windowSecs: 60,
  action: 'block',
  priority: 0,
  enabled: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /v1/check', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    const { redis } = await import('../plugins/redis')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (redis as any).flushall()

    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'proj_test' } as never)
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([FAKE_RULE] as never)
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  it('returns 400 when body is malformed', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: { bad: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
  })

  it('returns 401 when API key is invalid', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(401)
  })

  it('returns allowed=true when no rules match the path', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([
      { ...FAKE_RULE, pathPattern: '/api/other' },
    ] as never)

    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowed).toBe(true)
  })

  it('returns allowed=true when no rules exist', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([])

    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowed).toBe(true)
  })

  it('returns allowed=true with RFC headers when under the limit', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.allowed).toBe(true)
    expect(body.rule.remaining).toBe(2) // 3 limit, 1 used
    expect(res.headers['x-ratelimit-limit']).toBe('3')
    expect(res.headers['x-ratelimit-remaining']).toBe('2')
    expect(res.headers['x-ratelimit-reset']).toBeDefined()
  })

  it('returns 429 with RFC headers when limit is exceeded (action=block)', async () => {
    // Consume all 3 allowed requests
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    }
    // 4th request exceeds limit
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(429)

    const body = res.json()
    expect(body.allowed).toBe(false)
    expect(body.retryAfter).toBe(60)

    // RFC 6585 headers
    expect(res.headers['x-ratelimit-limit']).toBe('3')
    expect(res.headers['x-ratelimit-remaining']).toBe('0')
    expect(res.headers['x-ratelimit-reset']).toBeDefined()
    expect(res.headers['retry-after']).toBe('60')
  })

  it('RFC headers: Retry-After absent on 200 responses', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['retry-after']).toBeUndefined()
  })

  it('returns 200 (not 429) when action=log_only even if limit exceeded', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([
      { ...FAKE_RULE, action: 'log_only' },
    ] as never)

    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    }
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(200)
    // RFC headers still present even on log_only
    expect(res.headers['x-ratelimit-limit']).toBe('3')
  })

  it('FAIL OPEN: returns allowed=true when check exceeds timeout', async () => {
    // Override rule-cache to return a promise that never resolves (simulates hung Redis)
    vi.doMock('../lib/rule-cache', () => ({
      getRulesForProject: () => new Promise<never>(() => undefined),
      invalidateRulesCache: vi.fn(),
    }))
    // Re-build app so the new mock is used by this route registration
    await app.close()
    const slowApp = await buildApp()

    const res = await slowApp.inject({
      method: 'POST',
      url: '/v1/check',
      body: checkPayload(),
    })
    // Must return allowed=true even though the inner check never completes
    // (the 200ms real timeout fires and we fail open)
    expect(res.json().allowed).toBe(true)
    await slowApp.close()
    vi.doUnmock('../lib/rule-cache')
  }, 1000)

  it('glob matching: wildcard pattern matches sub-paths', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([
      { ...FAKE_RULE, pathPattern: '/api/auth/*', limitCount: 10 },
    ] as never)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/check',
      body: checkPayload({ path: '/api/auth/login' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowed).toBe(true)
  })

  it('enqueues a rate-limit event on every check (fire-and-forget)', async () => {
    const { rateLimitEventQueue } = await import('../lib/queue')
    await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(rateLimitEventQueue.add).toHaveBeenCalledOnce()
  })

  it('uses highest-priority rule when multiple rules match', async () => {
    const { prisma } = await import('../plugins/prisma')
    const lowPriRule: RateLimitRuleRecord = { ...FAKE_RULE, id: 'low', limitCount: 100, priority: 0 }
    const highPriRule: RateLimitRuleRecord = { ...FAKE_RULE, id: 'high', limitCount: 1, priority: 10 }
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([lowPriRule, highPriRule] as never)

    // Request 1 uses high-priority rule (limit=1) → allowed
    await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    // Request 2 → blocked by high-priority rule (count exceeds 1)
    const res = await app.inject({ method: 'POST', url: '/v1/check', body: checkPayload() })
    expect(res.statusCode).toBe(429)
  })
})
