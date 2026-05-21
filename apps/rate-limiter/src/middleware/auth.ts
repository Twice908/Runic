import { createHash } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../env'
import { redis } from '../plugins/redis'
import { prisma } from '../plugins/prisma'

const PROJECT_CACHE_TTL_SECS = 60
const projectCacheKey = (apiKeyHash: string): string => `rl:project:${apiKeyHash}`

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Fastify preHandler: validates RATE_LIMITER_INTERNAL_TOKEN.
 * Applied to all /v1/rules and /v1/analytics routes.
 */
export async function requireInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authorization header required' },
    })
    return
  }
  const token = authHeader.slice('Bearer '.length)
  if (token !== env.RATE_LIMITER_INTERNAL_TOKEN) {
    await reply.status(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid internal token' },
    })
  }
}

/**
 * Resolves and validates a project from the raw API key sent in the /v1/check body.
 * Uses a Redis project cache (TTL 60s) to avoid a DB read on every hot-path call.
 *
 * Returns the project {id} if valid and matches expectedProjectId, or null if
 * the key is invalid (reply already sent with 401 in that case).
 */
export async function resolveProject(
  rawApiKey: string,
  expectedProjectId: string,
  reply: FastifyReply,
): Promise<{ id: string } | null> {
  const apiKeyHash = hashApiKey(rawApiKey)

  // Try Redis project cache
  try {
    const cached = await redis.get(projectCacheKey(apiKeyHash))
    if (cached) {
      const project = JSON.parse(cached) as { id: string }
      if (project.id !== expectedProjectId) {
        await reply.status(401).send({
          success: false,
          error: { code: 'INVALID_KEY', message: 'API key does not match project' },
        })
        return null
      }
      return project
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  // DB lookup (cache miss)
  const project = await prisma.project.findUnique({
    where: { apiKeyHash },
    select: { id: true },
  })

  if (!project) {
    await reply.status(401).send({
      success: false,
      error: { code: 'INVALID_KEY', message: 'Invalid API key' },
    })
    return null
  }

  if (project.id !== expectedProjectId) {
    await reply.status(401).send({
      success: false,
      error: { code: 'INVALID_KEY', message: 'API key does not match project' },
    })
    return null
  }

  // Populate cache; never let a Redis write fail the hot path
  redis
    .setex(projectCacheKey(apiKeyHash), PROJECT_CACHE_TTL_SECS, JSON.stringify({ id: project.id }))
    .catch(() => null)

  return project
}
