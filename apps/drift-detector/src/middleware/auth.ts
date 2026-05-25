import { createHash } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../plugins/redis'
import { prisma } from '../plugins/prisma'

const PROJECT_CACHE_TTL_SECS = 60
const projectCacheKey = (apiKeyHash: string): string => `drift:project:${apiKeyHash}`

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Resolves a Project from the Bearer API key on the Authorization header.
 * Caches { id } in Redis (TTL 60s) to avoid a DB read on each ingest call.
 * Returns null if the key is missing or invalid — reply already sent in that case.
 */
export async function resolveProjectFromApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string } | null> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Bearer API key required' },
    })
    return null
  }

  const rawApiKey = authHeader.slice('Bearer '.length).trim()
  if (!rawApiKey) {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'API key missing' },
    })
    return null
  }

  const apiKeyHash = hashApiKey(rawApiKey)

  try {
    const cached = await redis.get(projectCacheKey(apiKeyHash))
    if (cached) return JSON.parse(cached) as { id: string }
  } catch {
    // Redis unavailable — fall through to DB
  }

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

  redis
    .setex(projectCacheKey(apiKeyHash), PROJECT_CACHE_TTL_SECS, JSON.stringify({ id: project.id }))
    .catch(() => null)

  return project
}
