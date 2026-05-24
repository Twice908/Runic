import type { Job } from 'bullmq'
import pino from 'pino'
import { prisma } from '@pulse/db'
import { evaluateRateLimitAlerts } from '../lib/alert-evaluator'

const logger = pino({ name: 'rate-limit-event-processor' })

export interface RateLimitEventJobData {
  projectId: string
  ruleId: string
  limitKey: string
  path: string
  action: 'blocked' | 'logged'
  timestamp: string
}

export async function processRateLimitEvent(job: Job<RateLimitEventJobData>): Promise<void> {
  const { projectId, ruleId, limitKey, path, action, timestamp } = job.data

  if (!projectId || !ruleId || !limitKey || !path || !action || !timestamp) {
    throw new Error(`Job ${job.id} is missing required fields: ${JSON.stringify(job.data)}`)
  }

  // createMany — always use the batch API, never individual create() calls.
  // This keeps the processor ready for future bulk-job upgrades with zero changes.
  await prisma.rateLimitEvent.createMany({
    data: [
      {
        projectId,
        ruleId,
        limitKey,
        path,
        action,
        timestamp: new Date(timestamp),
      },
    ],
  })

  // Evaluate rate_limit_spike alerts after each event — fire-and-forget.
  evaluateRateLimitAlerts(projectId).catch((err: unknown) => {
    logger.error({ projectId, err }, 'Rate limit alert evaluation failed after event')
  })

  logger.info({ jobId: job.id, projectId, ruleId, path, action }, 'Processed rate-limit-event job')
}
