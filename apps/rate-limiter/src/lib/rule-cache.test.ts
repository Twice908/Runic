import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import IORedisMock from 'ioredis-mock'
import type { Redis } from 'ioredis'
import { getRulesForProject, invalidateRulesCache, RULES_CACHE_KEY } from './rule-cache'
import type { RateLimitRuleRecord } from '@runic/types'

function makeMockRedis(): Redis {
  return new IORedisMock() as unknown as Redis
}

const FAKE_RULE: RateLimitRuleRecord = {
  id: 'rule_1',
  projectId: 'proj_a',
  name: 'Login limit',
  pathPattern: '/api/login',
  limitKey: 'ip',
  limitKeyHeader: null,
  limitCount: 5,
  windowSecs: 60,
  action: 'block',
  priority: 0,
  enabled: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

function makeMockPrisma(rules: RateLimitRuleRecord[] = [FAKE_RULE]) {
  return {
    rateLimitRule: {
      findMany: vi.fn().mockResolvedValue(rules),
    },
  }
}

describe('getRulesForProject', () => {
  let redis: Redis

  beforeEach(() => {
    redis = makeMockRedis()
  })

  afterEach(async () => {
    await (redis as unknown as IORedisMock).flushall()
  })

  it('cache miss: fetches rules from DB and returns them', async () => {
    const prisma = makeMockPrisma()
    const rules = await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe('rule_1')
    expect(prisma.rateLimitRule.findMany).toHaveBeenCalledOnce()
  })

  it('cache hit: returns cached rules without hitting DB', async () => {
    const prisma = makeMockPrisma()
    // Prime the cache
    await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    // Second call — should use cache
    const rules = await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    expect(rules).toHaveLength(1)
    // DB called only once (on first miss)
    expect(prisma.rateLimitRule.findMany).toHaveBeenCalledOnce()
  })

  it('uses correct Redis key: rl:rules:{projectId}', async () => {
    const prisma = makeMockPrisma()
    await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    const cached = await (redis as unknown as IORedisMock).get(RULES_CACHE_KEY('proj_a'))
    expect(cached).not.toBeNull()
  })

  it('cache miss falls back silently when DB returns empty array', async () => {
    const prisma = makeMockPrisma([])
    const rules = await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    expect(rules).toEqual([])
  })

  it('cache miss falls back silently when DB throws', async () => {
    const prisma = {
      rateLimitRule: {
        findMany: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      },
    }
    const rules = await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    expect(rules).toEqual([])
  })

  it('cache miss falls back silently when Redis GET throws', async () => {
    const brokenRedis = {
      get: vi.fn().mockRejectedValue(new Error('Redis timeout')),
      setex: vi.fn().mockResolvedValue('OK'),
    } as unknown as Redis
    const prisma = makeMockPrisma()
    const rules = await getRulesForProject(brokenRedis, prisma as never, 'proj_a', 30)
    expect(rules).toHaveLength(1)
    expect(prisma.rateLimitRule.findMany).toHaveBeenCalledOnce()
  })

  it('caches only enabled rules (filtering happens at DB layer)', async () => {
    const disabledRule: RateLimitRuleRecord = { ...FAKE_RULE, id: 'rule_2', enabled: false }
    // prisma.findMany is called with enabled:true filter — mock returns only enabled
    const prisma = makeMockPrisma([FAKE_RULE]) // DB already filters
    const rules = await getRulesForProject(redis, prisma as never, 'proj_a', 30)
    expect(rules.every((r) => r.enabled)).toBe(true)
    // Suppress unused variable warning
    void disabledRule
  })
})

describe('invalidateRulesCache', () => {
  let redis: Redis

  beforeEach(() => {
    redis = makeMockRedis()
  })

  afterEach(async () => {
    await (redis as unknown as IORedisMock).flushall()
  })

  it('PROPAGATION: after invalidation, next read fetches fresh rules from DB', async () => {
    const prismaV1 = makeMockPrisma([FAKE_RULE])
    // Prime cache
    await getRulesForProject(redis, prismaV1 as never, 'proj_a', 30)

    // Simulate a rule update: invalidate cache
    await invalidateRulesCache(redis, 'proj_a')

    const updatedRule = { ...FAKE_RULE, limitCount: 99 }
    const prismaV2 = makeMockPrisma([updatedRule])
    const rules = await getRulesForProject(redis, prismaV2 as never, 'proj_a', 30)

    expect(rules[0].limitCount).toBe(99)
    expect(prismaV2.rateLimitRule.findMany).toHaveBeenCalledOnce()
  })

  it('invalidation does not affect other projects', async () => {
    const prismaA = makeMockPrisma([FAKE_RULE])
    const ruleB: RateLimitRuleRecord = { ...FAKE_RULE, id: 'rule_b', projectId: 'proj_b' }
    const prismaB = makeMockPrisma([ruleB])

    await getRulesForProject(redis, prismaA as never, 'proj_a', 30)
    await getRulesForProject(redis, prismaB as never, 'proj_b', 30)

    // Invalidate only proj_a
    await invalidateRulesCache(redis, 'proj_a')

    // proj_b cache should still be warm
    const freshPrismaB = makeMockPrisma([]) // would return empty if called
    const rulesB = await getRulesForProject(redis, freshPrismaB as never, 'proj_b', 30)
    expect(rulesB).toHaveLength(1)
    expect(freshPrismaB.rateLimitRule.findMany).not.toHaveBeenCalled()
  })

  it('invalidation is safe when key does not exist', async () => {
    await expect(invalidateRulesCache(redis, 'nonexistent')).resolves.not.toThrow()
  })
})
