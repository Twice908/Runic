import { Worker } from 'bullmq'
import pino from 'pino'
import { env } from './env'
import { processIngest } from './processors/ingest.processor'

const logger = pino({ name: 'worker', level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const worker = new Worker('ingest', processIngest, { connection })

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Job completed')
})

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Job failed')
})

logger.info('Worker started, listening for jobs...')
