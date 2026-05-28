import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { RateLimiter } from '../rate-limit'
import type { RateLimitOptions } from '../rate-limit'

async function rateLimitPluginImpl(
  fastify: FastifyInstance,
  options: RateLimitOptions,
): Promise<void> {
  const limiter = new RateLimiter(options)

  // Mirrors pulsePlugin shutdown handling.
  const cleanup = () => { limiter.destroy() }
  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip =
        (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        request.socket?.remoteAddress ??
        '0.0.0.0'

      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(request.headers)) {
        headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
      }

      const outcome = await limiter.check({
        // routerPath is the matched route pattern; fall back to raw URL path.
        path: request.routerPath ?? request.url.split('?')[0] ?? request.url,
        method: request.method,
        ip,
        apiKey: (request.headers['authorization'] ?? '').replace(/^Bearer\s+/i, ''),
        headers,
      })

      const prefix = limiter.prefix

      if (!outcome.allowed) {
        reply.headers({
          'Retry-After': String(outcome.retryAfter ?? 60),
          'X-RateLimit-Limit': String(outcome.meta?.limit ?? 0),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(outcome.meta?.resetAt ?? 0),
        })
        reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Try again later.',
          retryAfter: outcome.retryAfter ?? 60,
        })
        return
      }

      if (outcome.meta) {
        void reply.header(`${prefix}-Limit`, outcome.meta.limit)
        void reply.header(`${prefix}-Remaining`, outcome.meta.remaining)
        void reply.header(`${prefix}-Reset`, outcome.meta.resetAt)
      }
    } catch {
      // Never throw from a hook — fail open on unexpected errors
    }
  })
}

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  fastify: '4.x',
  name: 'pulse-rate-limit',
})
