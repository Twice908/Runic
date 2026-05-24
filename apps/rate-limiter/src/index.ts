import './env-loader'
import { buildServer } from './server'
import { env } from './env'

async function main(): Promise<void> {
  const app = await buildServer()
  const address = await app.listen({
    port: parseInt(env.RATE_LIMITER_PORT, 10),
    host: '0.0.0.0',
  })
  app.log.info(`Rate Limiter service listening at ${address}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
