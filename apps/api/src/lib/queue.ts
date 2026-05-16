import { Queue } from 'bullmq'
import { env } from '../env'

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

export const INGEST_QUEUE_NAME = 'ingest'

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
})
