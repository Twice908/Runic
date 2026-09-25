import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { RunicClient } from '../core/client'
import { BatchBuffer } from '../core/buffer'
import { setClient } from '../core/errors'
import type { RunicConfig, IngestEvent } from '../types'

// Augment FastifyRequest to hold the per-request start time.
declare module 'fastify' {
  interface FastifyRequest {
    runicStartTime?: number
  }
}

async function runicPluginImpl(fastify: FastifyInstance, config: RunicConfig): Promise<void> {
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

  const shutdown = () => {
    buffer.stop().catch(() => undefined)
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  const ignoreMethods = new Set(
    (config.ignoreMethods ?? []).map((m) => m.toUpperCase()),
  )
  const ignoreRoutes = config.ignoreRoutes ?? []

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.runicStartTime = Date.now()
  })

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (request.headers['x-runic-skip-log'] === 'true') return
      if (ignoreMethods.has(request.method.toUpperCase())) return

      const path = request.url.split('?')[0] ?? request.url
      for (const prefix of ignoreRoutes) {
        if (path.startsWith(prefix)) return
      }

      const responseTime = Date.now() - (request.runicStartTime ?? Date.now())
      const event: IngestEvent = {
        method: request.method,
        // routerPath is the matched route pattern (e.g. /users/:id); fall back to raw URL.
        route: request.routerPath ?? path,
        statusCode: reply.statusCode,
        responseTime,
        timestamp: new Date().toISOString(),
      }
      buffer.add(event)
    } catch {
      // Never throw from a hook.
    }
  })
}

export const runicPlugin = fp(runicPluginImpl, {
  fastify: '4.x',
  name: 'runic',
})
