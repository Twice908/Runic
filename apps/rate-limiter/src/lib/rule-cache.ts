import type { Redis } from 'ioredis'
import type { PrismaClient } from '@prisma/client'
import type { RateLimitRuleRecord } from '@pulse/types'

export const RULES_CACHE_KEY = (projectId: string): string => `rl:rules:${projectId}`

/**
 * Returns the active (enabled) rules for a project.
 * Order of precedence: Redis cache → DB fetch → populate cache → return.
 * Every failure path silently falls back; this function never throws.
 */
export async function getRulesForProject(
  redis: Redis,
  prisma: PrismaClient,
  projectId: string,
  ttlSecs: number,
): Promise<RateLimitRuleRecord[]> {
  // Try cache
  try {
    const cached = await redis.get(RULES_CACHE_KEY(projectId))
    if (cached) {
      return JSON.parse(cached) as RateLimitRuleRecord[]
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  // Cache miss: fetch from DB
  try {
    const rules = await prisma.rateLimitRule.findMany({
      where: { projectId, enabled: true },
      orderBy: { priority: 'desc' },
    })

    const records = rules as unknown as RateLimitRuleRecord[]

    // Populate cache; ignore errors (e.g. Redis write failure)
    redis.setex(RULES_CACHE_KEY(projectId), ttlSecs, JSON.stringify(records)).catch(() => null)

    return records
  } catch {
    return []
  }
}

/**
 * Deletes the rules cache entry for a project.
 * Called after any rule create / update / toggle so the next /v1/check
 * re-fetches fresh rules from DB within at most one cache TTL (30s).
 */
export async function invalidateRulesCache(redis: Redis, projectId: string): Promise<void> {
  await redis.del(RULES_CACHE_KEY(projectId)).catch(() => null)
}
