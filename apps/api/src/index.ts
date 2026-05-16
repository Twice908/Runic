import Fastify from 'fastify'
import { env } from './env'
import { registerCors } from './plugins/cors'
import { registerHelmet } from './plugins/helmet'
import { registerRateLimit } from './plugins/rate-limit'
import { healthRoutes } from './routes/health'
import { ingestRoutes } from './routes/ingest'

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  })

  await registerCors(app)
  await registerHelmet(app)
  await registerRateLimit(app)

  await app.register(healthRoutes)
  await app.register(ingestRoutes)

  const address = await app.listen({ port: parseInt(env.PORT), host: '0.0.0.0' })
  app.log.info(`API server listening at ${address}`)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
