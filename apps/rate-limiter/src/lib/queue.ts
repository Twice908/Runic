import { Queue } from 'bullmq'
import { redisUrl } from '../env'

const parsed = new URL(redisUrl)

const connection = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '6379', 10),
  password: parsed.password || undefined,
}

export const RATE_LIMIT_EVENT_QUEUE = 'rate-limit-events'

export const rateLimitEventQueue = new Queue(RATE_LIMIT_EVENT_QUEUE, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
})
