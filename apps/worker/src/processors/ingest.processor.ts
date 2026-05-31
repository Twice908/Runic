import type { Job } from 'bullmq'
import pino from 'pino'
import { prisma } from '@pulse/db'
import type { IngestEvent } from '@pulse/types'
import { redis } from '../lib/redis'

const logger = pino({ name: 'ingest-processor' })

export interface IngestJobData extends IngestEvent {
  projectId: string
}

export async function processIngest(job: Job<IngestJobData>): Promise<void> {
  const { projectId, method, route, statusCode, responseTime, timestamp, stack } = job.data

  if (!projectId || !method || !route || statusCode == null || responseTime == null || !timestamp) {
    throw new Error(`Job ${job.id} is missing required fields: ${JSON.stringify(job.data)}`)
  }

  const ts = new Date(timestamp)

  const log = await prisma.requestLog.create({
    data: { projectId, method, route, statusCode, responseTime, timestamp: ts },
  })

  await redis.publish(
    `logs:${projectId}`,
    JSON.stringify({
      id: log.id,
      method: log.method,
      route: log.route,
      statusCode: log.statusCode,
      responseTime: log.responseTime,
      timestamp: log.timestamp.toISOString(),
    }),
  )

  if (statusCode >= 400) {
    await upsertErrorEvent({ projectId, route, statusCode, timestamp: ts, stack })
  }

  logger.info({ jobId: job.id, projectId, route, statusCode, responseTime }, 'Processed ingest job')
}

async function upsertErrorEvent(params: {
  projectId: string
  route: string
  statusCode: number
  timestamp: Date
  stack?: string
}): Promise<void> {
  const { projectId, route, statusCode, timestamp, stack } = params

  await prisma.errorEvent.upsert({
    where: {
      projectId_route_statusCode: { projectId, route, statusCode },
    },
    update: {
      count: { increment: 1 },
      lastSeen: timestamp,
      // Update stack with the most recent non-null trace
      ...(stack ? { stack } : {}),
    },
    create: {
      projectId,
      route,
      statusCode,
      message: `HTTP ${statusCode}`,
      stack: stack ?? null,
      firstSeen: timestamp,
      lastSeen: timestamp,
    },
  })
}
