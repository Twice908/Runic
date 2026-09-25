import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { RunicClient } from '../core/client'
import { BatchBuffer } from '../core/buffer'
import { sanitizeHeaders, sanitizeBody } from '../core/sanitizer'
import { setClient } from '../core/errors'
import type { RunicConfig, IngestEvent } from '../types'

export function runic(config: RunicConfig): RequestHandler {
  const client = new RunicClient({
    apiKey: config.apiKey,
    host: config.host,
    timeout: config.timeout,
    debug: config.debug,
  })

  setClient(client)

  const buffer = new BatchBuffer({
    onFlush: (events) => client.send(events),
  })

  buffer.start()

  // Flush remaining events on graceful shutdown.
  const shutdown = () => {
    buffer.stop().catch(() => undefined)
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  const ignoreMethods = new Set(
    (config.ignoreMethods ?? []).map((m) => m.toUpperCase()),
  )

  return function runicMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
      if (req.headers['x-runic-skip-log'] === 'true') {
        next()
        return
      }

      // Skip ignored methods.
      if (ignoreMethods.has(req.method.toUpperCase())) {
        next()
        return
      }

      // Skip ignored route prefixes.
      const ignoreRoutes = config.ignoreRoutes ?? []
      for (const prefix of ignoreRoutes) {
        if (req.path.startsWith(prefix)) {
          next()
          return
        }
      }

      const startTime = Date.now()
      const originalEnd = res.end.bind(res)

      // @ts-expect-error — patching res.end to intercept the response
      res.end = function patchedEnd(...args: Parameters<typeof res.end>) {
        try {
          const responseTime = Date.now() - startTime
          const event: IngestEvent = {
            method: req.method,
            // Prefer the matched route pattern; fall back to raw path.
            route: (req.route as { path?: string } | undefined)?.path ?? req.path,
            statusCode: res.statusCode,
            responseTime,
            timestamp: new Date().toISOString(),
          }
          buffer.add(event)
        } catch {
          // Never let instrumentation crash the response.
        }
        return originalEnd(...args)
      }
    } catch {
      // Never throw from middleware.
    }

    next()
  }
}
