import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { RateLimiter } from '../rate-limit'
import type { RateLimitOptions } from '../rate-limit'

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const limiter = new RateLimiter(options)

  // Flush and clean up on graceful shutdown — mirrors pulse() shutdown handling.
  const cleanup = () => { limiter.destroy() }
  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (req.headers['x-pulse-skip-log'] === 'true') {
        next()
        return
      }

      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        req.socket?.remoteAddress ??
        '0.0.0.0'

      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
      }

      const outcome = await limiter.check({
        // Prefer the matched route pattern (/users/:id) over raw path (/users/123)
        path: (req.route as { path?: string } | undefined)?.path ?? req.path,
        method: req.method,
        ip,
        apiKey: (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, ''),
        headers,
      })

      const prefix = limiter.prefix

      if (!outcome.allowed) {
        res.set('Retry-After', String(outcome.retryAfter ?? 60))
        res.set(`${prefix}-Limit`, String(outcome.meta?.limit ?? 0))
        res.set(`${prefix}-Remaining`, '0')
        res.set(`${prefix}-Reset`, String(outcome.meta?.resetAt ?? 0))
        res.status(429).json({
          error: 'Too Many Requests',
          retryAfter: outcome.retryAfter ?? 60,
        })
        return
      }

      if (outcome.meta) {
        res.setHeader(`${prefix}-Limit`, outcome.meta.limit)
        res.setHeader(`${prefix}-Remaining`, outcome.meta.remaining)
        res.setHeader(`${prefix}-Reset`, outcome.meta.resetAt)
      }

      next()
    } catch {
      next()
    }
  }
}
