import { createHash } from 'node:crypto'
import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import pino from 'pino'

const logger = pino({ name: 'rate-limiter-check' })
import micromatch from 'micromatch'
import { redis } from '../plugins/redis'
import { prisma } from '../plugins/prisma'
import { getRulesForProject } from '../lib/rule-cache'
import { incrementCounter } from '../lib/counter'
import { rateLimitEventQueue } from '../lib/queue'
import { resolveProject } from '../middleware/auth'
import { ruleCacheTtl, checkTimeoutMs } from '../env'
import type { RateLimitRuleRecord, CheckResponse } from '@pulse/types'

const checkBodySchema = z.object({
  projectId: z.string().min(1),
  apiKey: z.string().min(1),
  path: z.string().min(1),
  method: z.string().min(1),
  ip: z.string().min(1),
  headers: z.record(z.string()),
})

type CheckBody = z.infer<typeof checkBodySchema>

/**
 * Derives the rate-limit counter key value from the request.
 * Returns null if the key cannot be extracted (triggers fail-open).
 * Never stores PII (email, password) — only IP, opaque key hash, userId.
 */
function extractKeyValue(body: CheckBody, rule: RateLimitRuleRecord): string | null {
  switch (rule.limitKey) {
    case 'ip':
      return body.ip

    case 'apiKey': {
      // Use a custom header if specified, otherwise use the request apiKey
      const rawKey = rule.limitKeyHeader
        ? body.headers[rule.limitKeyHeader.toLowerCase()] ?? body.apiKey
        : body.apiKey
      // Store a 32-char hex hash — opaque, not reversible to the original key
      return createHash('sha256').update(rawKey).digest('hex').slice(0, 32)
    }

    case 'userId': {
      const userId = body.headers['x-user-id']
      return userId ?? null
    }

    case 'global':
      return 'global'

    default:
      return null
  }
}

/**
 * Core check logic. Returns a typed outcome or throws on unexpected errors.
 * Separated from the Fastify handler so it can be wrapped in a timeout race.
 */
async function runCheck(body: CheckBody): Promise<CheckResponse> {
  const rules = await getRulesForProject(redis, prisma, body.projectId, ruleCacheTtl)

  if (rules.length === 0) {
    return { allowed: true }
  }

  // Match path against each rule's glob pattern; sort by priority descending
  const matchingRules = rules
    .filter((r) => micromatch.isMatch(body.path, r.pathPattern))
    .sort((a, b) => b.priority - a.priority)

  if (matchingRules.length === 0) {
    return { allowed: true }
  }

  const rule = matchingRules[0]
  const keyValue = extractKeyValue(body, rule)

  if (!keyValue) {
    return { allowed: true }
  }

  const counter = await incrementCounter(
    redis,
    body.projectId,
    rule.id,
    keyValue,
    rule.windowSecs,
    rule.limitCount,
  )

  const meta = {
    id: rule.id,
    limit: rule.limitCount,
    remaining: counter.remaining,
    resetAt: counter.resetAt,
  }

  const eventAction = !counter.allowed ? 'blocked' : 'logged'

  // Fire-and-forget: enqueue event — never await, never let queue failure affect hot path
  rateLimitEventQueue
    .add('event', {
      projectId: body.projectId,
      ruleId: rule.id,
      limitKey: keyValue,
      path: body.path,
      action: eventAction,
      timestamp: new Date().toISOString(),
    })
    .then((job) => {
      logger.debug(
        { jobId: job.id, projectId: body.projectId, path: body.path, action: eventAction },
        'Rate limit event enqueued',
      )
    })
    .catch(() => null)

  if (!counter.allowed && rule.action === 'block') {
    return {
      allowed: false,
      rule: meta,
      retryAfter: rule.windowSecs,
    }
  }

  return { allowed: true, rule: meta }
}

export async function checkRoutes(app: FastifyInstance): Promise<void> {
  app.post('/check', async (request, reply) => {
    const parsed = checkBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    const { projectId, apiKey } = parsed.data

    // Validate project API key (Redis cache → DB fallback)
    const project = await resolveProject(apiKey, projectId, reply)
    if (!project) return // reply already sent by resolveProject

    // Timeout wrapper — abort and fail open if check exceeds checkTimeoutMs
    let outcome: CheckResponse
    try {
      outcome = await Promise.race([
        runCheck(parsed.data),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), checkTimeoutMs)),
      ]).then((result) => {
        if (result === null) {
          request.log.warn({ projectId }, 'check timeout — failing open')
          return { allowed: true } as CheckResponse
        }
        return result
      })
    } catch (err) {
      request.log.error({ projectId, err: String(err) }, 'check error — failing open')
      return reply.send({ allowed: true })
    }

    // RFC 6585 headers — present on every response that evaluated a rule
    const meta = (outcome as { rule?: { limit: number; remaining: number; resetAt: number } }).rule
    if (meta) {
      reply.header('X-RateLimit-Limit', meta.limit)
      reply.header('X-RateLimit-Remaining', meta.remaining)
      reply.header('X-RateLimit-Reset', meta.resetAt)
    }

    if (!outcome.allowed) {
      const { retryAfter } = outcome as { retryAfter: number }
      reply.header('Retry-After', retryAfter)
    }

    return reply.send(outcome)
  })
}
