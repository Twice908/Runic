import './env-loader'
import { Readable } from 'node:stream'
import Fastify from 'fastify'
import { env } from './env'
import { registerCors } from './plugins/cors'
import { registerHelmet } from './plugins/helmet'
import { registerRateLimit } from './plugins/rate-limit'
import { healthRoutes } from './routes/health'
import { ingestRoutes } from './routes/ingest'
import { projectRoutes } from './routes/projects'
import { analyticsRoutes } from './routes/analytics'
import { alertRoutes } from './routes/alerts'
import { clerkWebhookRoutes } from './routes/webhooks/clerk'

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  })

  // Capture raw request body before Fastify parses it — required for
  // svix webhook signature verification in the Clerk webhook route.
  app.addHook('preParsing', async (request, _reply, payload) => {
    const chunks: Buffer[] = []
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    const raw = Buffer.concat(chunks)
    ;(request as unknown as { rawBody: Buffer }).rawBody = raw
    const stream = new Readable({ read() {} })
    stream.push(raw)
    stream.push(null)
    return stream
  })

  await registerCors(app)
  await registerHelmet(app)
  await registerRateLimit(app)

  await app.register(healthRoutes)
  await app.register(clerkWebhookRoutes)
  await app.register(ingestRoutes)
  await app.register(projectRoutes)
  await app.register(analyticsRoutes)
  await app.register(alertRoutes)

  const address = await app.listen({ port: parseInt(env.PORT), host: '0.0.0.0' })
  app.log.info(`API server listening at ${address}`)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
