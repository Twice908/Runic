import './env-loader'
import { Worker, Queue } from 'bullmq'
import pino from 'pino'
import { env } from './env'
import { processIngest } from './processors/ingest.processor'
import { processUptimeCheck } from './processors/uptime.processor'

const logger = pino({ name: 'worker', level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const UPTIME_JOB_NAME = 'uptime-check'
const UPTIME_REPEAT_MS = 60_000

// ── Ingest worker ────────────────────────────────────────────────────────────
const ingestWorker = new Worker('ingest', processIngest, {
  connection,
  concurrency: 10,
})

ingestWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id }, 'Ingest job completed')
})

ingestWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message, stack: err.stack }, 'Ingest job failed')
})

// ── Uptime repeatable worker ─────────────────────────────────────────────────
const uptimeQueue = new Queue('uptime', { connection })

const uptimeWorker = new Worker(
  'uptime',
  async () => {
    await processUptimeCheck()
  },
  { connection, concurrency: 1 },
)

uptimeWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Uptime job failed')
})

async function registerUptimeJob(): Promise<void> {
  // Remove stale repeatable jobs with the same name to prevent duplicates on restart.
  const repeatableJobs = await uptimeQueue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.name === UPTIME_JOB_NAME) {
      await uptimeQueue.removeRepeatableByKey(job.key)
      logger.info({ key: job.key }, 'Removed stale uptime repeatable job')
    }
  }

  await uptimeQueue.add(UPTIME_JOB_NAME, {}, { repeat: { every: UPTIME_REPEAT_MS } })
  logger.info({ repeatEveryMs: UPTIME_REPEAT_MS }, 'Uptime repeatable job registered')
}

registerUptimeJob().catch((err: unknown) => {
  logger.error({ err }, 'Failed to register uptime repeatable job')
})

logger.info('Worker started — ingest queue + uptime repeatable job active')
