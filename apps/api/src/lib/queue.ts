import { Queue } from 'bullmq'
import { env } from '../env'

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const defaultJobOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
}

const agentSpanJobOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}

export const INGEST_QUEUE_NAME = 'ingest'

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, {
  connection,
  defaultJobOptions,
})

export const AGENT_SPANS_QUEUE_NAME = 'agent-spans'

export const agentSpansQueue = new Queue(AGENT_SPANS_QUEUE_NAME, {
  connection,
  defaultJobOptions: agentSpanJobOptions,
})
