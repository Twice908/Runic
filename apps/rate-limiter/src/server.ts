import Fastify, { type FastifyInstance } from 'fastify'
import { env } from './env'
import { checkRoutes } from './routes/check'
import { rulesRoutes } from './routes/rules'
import { analyticsRoutes } from './routes/analytics'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      formatters: {
        // Stamp every log line with service name for log aggregation
        bindings: () => ({ service: 'rate-limiter' }),
      },
    },
  })

  // Consistent error envelope — never expose stack traces externally
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

  await app.register(checkRoutes, { prefix: '/v1' })
  await app.register(rulesRoutes, { prefix: '/v1' })
  await app.register(analyticsRoutes, { prefix: '/v1' })

  return app
}
