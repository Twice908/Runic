import { Queue } from 'bullmq'
import { redisUrl } from '../env'

const parsed = new URL(redisUrl)

const connection = {
  host: parsed.hostname,
  port: parseInt(parsed.port || '6379', 10),
  password: parsed.password || undefined,
}

export const DRIFT_DIFF_QUEUE = 'drift:diff'

export interface DriftDiffJobData {
  manifestId: string
  projectId: string
  environmentId: string
}

export const driftDiffQueue = new Queue<DriftDiffJobData>(DRIFT_DIFF_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
})
