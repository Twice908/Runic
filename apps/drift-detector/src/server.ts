import Fastify, { type FastifyInstance } from 'fastify'
import { env } from './env'
import { snapshotRoutes } from './routes/snapshot'
import { matrixRoutes } from './routes/matrix'
import { keysRoutes } from './routes/keys'
import { ciCheckRoutes } from './routes/ciCheck'
import { eventsRoutes } from './routes/events'
import { baselineRoutes } from './routes/baseline'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      formatters: {
        bindings: () => ({ service: 'drift-detector' }),
      },
    },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('access-control-allow-origin', '*')
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    reply.header('access-control-allow-headers', 'authorization,content-type')
  })

  app.options('/*', async (_request, reply) => {
    reply.status(204).send()
  })

  app.setErrorHandler((err, request, reply) => {
    request.log.error(
      { err: err.message, code: err.code },
      'unhandled error',
    )
    const isUserError = err.statusCode !== undefined && err.statusCode < 500
    reply.status(err.statusCode ?? 500).send({
      success: false,
      error: {
        code: err.code ?? 'INTERNAL_ERROR',
        message: isUserError ? err.message : 'An unexpected error occurred',
      },
    })
  })

  await app.register(snapshotRoutes, { prefix: '/v1' })
  await app.register(matrixRoutes, { prefix: '/v1' })
  await app.register(keysRoutes, { prefix: '/v1' })
  await app.register(ciCheckRoutes, { prefix: '/v1' })
  await app.register(eventsRoutes, { prefix: '/v1' })
  await app.register(baselineRoutes, { prefix: '/v1' })

  return app
}
