import './env-loader'
import { buildServer } from './server'
import { env } from './env'
import { driftDiffWorker } from './workers/diffWorker'

async function main(): Promise<void> {
  const app = await buildServer()
  const address = await app.listen({
    port: parseInt(env.DRIFT_COLLECTOR_PORT, 10),
    host: '0.0.0.0',
  })
  app.log.info(`Drift Detector service listening at ${address}`)
  app.log.info(
    { queue: driftDiffWorker.name, concurrency: 5 },
    'Drift diff worker started',
  )

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down')
    await driftDiffWorker.close()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
