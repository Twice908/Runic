import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type IORedisMock from 'ioredis-mock'
import Fastify from 'fastify'
import { rulesRoutes } from './rules'

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Async factory: the IORedisMock instance is created once here and reused on
// every import('../plugins/redis') call within this file.
vi.mock('../plugins/redis', async () => {
  const { default: IORedisMock } = await import('ioredis-mock')
  return { redis: new IORedisMock() }
})

vi.mock('../plugins/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    rateLimitRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../env', () => ({
  env: { RATE_LIMITER_INTERNAL_TOKEN: 'secret-token', NODE_ENV: 'test' },
  ruleCacheTtl: 30,
  checkTimeoutMs: 100,
  redisUrl: 'redis://localhost:6379',
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INTERNAL_AUTH = { authorization: 'Bearer secret-token' }

async function buildApp() {
  const app = Fastify({ logger: false })
  app.setErrorHandler((err, _req, reply) => {
    reply.status(err.statusCode ?? 500).send({
      success: false,
      error: { code: err.code ?? 'ERR', message: err.message },
    })
  })
  await app.register(rulesRoutes, { prefix: '/v1' })
  return app
}

// Convenience: get the single IORedisMock instance from the mocked module
async function getMockRedis() {
  const { redis } = await import('../plugins/redis')
  return redis as unknown as InstanceType<typeof IORedisMock>
}

const BASE_RULE_DB = {
  id: 'rule_abc',
  projectId: 'proj_1',
  name: 'Login rate limit',
  pathPattern: '/api/login',
  limitKey: 'ip',
  limitKeyHeader: null,
  limitCount: 5,
  windowSecs: 60,
  action: 'block',
  priority: 0,
  enabled: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /v1/rules/:projectId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => { app = await buildApp() })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('returns 401 without internal token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/rules/proj_1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 with wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/rules/proj_1',
      headers: { authorization: 'Bearer wrong' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns rules for the project', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([BASE_RULE_DB] as never)

    const res = await app.inject({ method: 'GET', url: '/v1/rules/proj_1', headers: INTERNAL_AUTH })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('rule_abc')
  })
})

describe('POST /v1/rules/:projectId — create rule', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    const r = await getMockRedis()
    await r.flushall()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  const validBody = {
    name: 'Login limit',
    pathPattern: '/api/login',
    limitKey: 'ip',
    limitCount: 10,
    windowSecs: 60,
    action: 'block',
  }

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rules/proj_1',
      headers: INTERNAL_AUTH,
      body: { bad: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 on DUPLICATE (same projectId + pathPattern + limitKey)', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findFirst).mockResolvedValue(BASE_RULE_DB as never)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/rules/proj_1',
      headers: INTERNAL_AUTH,
      body: validBody,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('DUPLICATE_RULE')
  })

  it('returns 404 when project does not exist', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/rules/nonexistent',
      headers: INTERNAL_AUTH,
      body: validBody,
    })
    expect(res.statusCode).toBe(404)
  })

  it('creates rule and invalidates Redis cache', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'proj_1' } as never)
    vi.mocked(prisma.rateLimitRule.create).mockResolvedValue(BASE_RULE_DB as never)

    const r = await getMockRedis()
    await r.setex('rl:rules:proj_1', 30, '[]')
    expect(await r.get('rl:rules:proj_1')).not.toBeNull()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/rules/proj_1',
      headers: INTERNAL_AUTH,
      body: validBody,
    })
    expect(res.statusCode).toBe(201)
    expect(await r.get('rl:rules:proj_1')).toBeNull() // cache invalidated
  })
})

describe('PATCH /v1/rules/:ruleId — update rule', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    const r = await getMockRedis()
    await r.flushall()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('returns 404 when rule does not exist', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/rules/nonexistent',
      headers: INTERNAL_AUTH,
      body: { limitCount: 50 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('updates rule and invalidates Redis cache', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findUnique).mockResolvedValue(BASE_RULE_DB as never)
    vi.mocked(prisma.rateLimitRule.update).mockResolvedValue({ ...BASE_RULE_DB, limitCount: 50 } as never)

    const r = await getMockRedis()
    await r.setex('rl:rules:proj_1', 30, '[]')

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/rules/rule_abc',
      headers: INTERNAL_AUTH,
      body: { limitCount: 50 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.limitCount).toBe(50)
    expect(await r.get('rl:rules:proj_1')).toBeNull() // cache invalidated
  })
})

describe('PUT /v1/rules/:ruleId/toggle', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    const r = await getMockRedis()
    await r.flushall()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('flips enabled from true → false and invalidates cache', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findUnique).mockResolvedValue(BASE_RULE_DB as never)
    vi.mocked(prisma.rateLimitRule.update).mockResolvedValue({ ...BASE_RULE_DB, enabled: false } as never)

    const r = await getMockRedis()
    await r.setex('rl:rules:proj_1', 30, JSON.stringify([BASE_RULE_DB]))

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/rules/rule_abc/toggle',
      headers: INTERNAL_AUTH,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.enabled).toBe(false)
    expect(await r.get('rl:rules:proj_1')).toBeNull() // cache invalidated
  })

  it('PROPAGATION: after toggle, next getRulesForProject call hits DB (cache miss)', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findUnique).mockResolvedValue(BASE_RULE_DB as never)
    vi.mocked(prisma.rateLimitRule.update).mockResolvedValue({ ...BASE_RULE_DB, enabled: false } as never)
    vi.mocked(prisma.rateLimitRule.findMany).mockResolvedValue([])

    const r = await getMockRedis()
    await r.setex('rl:rules:proj_1', 30, JSON.stringify([BASE_RULE_DB]))

    await app.inject({ method: 'PUT', url: '/v1/rules/rule_abc/toggle', headers: INTERNAL_AUTH })

    // Cache gone — next read must hit DB
    expect(await r.get('rl:rules:proj_1')).toBeNull()

    const { getRulesForProject } = await import('../lib/rule-cache')
    await getRulesForProject(r as never, prisma as never, 'proj_1', 30)
    expect(prisma.rateLimitRule.findMany).toHaveBeenCalledOnce()
  })

  it('returns 404 for non-existent rule', async () => {
    const { prisma } = await import('../plugins/prisma')
    vi.mocked(prisma.rateLimitRule.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/rules/ghost/toggle',
      headers: INTERNAL_AUTH,
    })
    expect(res.statusCode).toBe(404)
  })
})
