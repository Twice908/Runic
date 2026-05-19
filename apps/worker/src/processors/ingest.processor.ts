import type { Job } from 'bullmq'
import pino from 'pino'
import { prisma } from '@pulse/db'
import type { IngestEvent } from '@pulse/types'
import { evaluateAlerts } from '../lib/alert-evaluator'

const logger = pino({ name: 'ingest-processor' })

export interface IngestJobData extends IngestEvent {
  projectId: string
}

export async function processIngest(job: Job<IngestJobData>): Promise<void> {
  const { projectId, method, route, statusCode, responseTime, timestamp } = job.data

  if (!projectId || !method || !route || statusCode == null || responseTime == null || !timestamp) {
    throw new Error(`Job ${job.id} is missing required fields: ${JSON.stringify(job.data)}`)
  }

  const ts = new Date(timestamp)

  await prisma.requestLog.create({
    data: { projectId, method, route, statusCode, responseTime, timestamp: ts },
  })

  if (statusCode >= 400) {
    await upsertErrorEvent({ projectId, route, statusCode, timestamp: ts })
  }

  // Evaluate error_rate and response_time alerts after each ingested event.
  // Fire-and-forget — never throw into the ingest job on evaluator failure.
  evaluateAlerts(projectId).catch((err: unknown) => {
    logger.error({ projectId, err }, 'Alert evaluation failed after ingest')
  })

  logger.info({ jobId: job.id, projectId, route, statusCode, responseTime }, 'Processed ingest job')
}

async function upsertErrorEvent(params: {
  projectId: string
  route: string
  statusCode: number
  timestamp: Date
}): Promise<void> {
  const { projectId, route, statusCode, timestamp } = params

  await prisma.errorEvent.upsert({
    where: {
      projectId_route_statusCode: { projectId, route, statusCode },
    },
    update: {
      count: { increment: 1 },
      lastSeen: timestamp,
    },
    create: {
      projectId,
      route,
      statusCode,
      message: `HTTP ${statusCode}`,
      firstSeen: timestamp,
      lastSeen: timestamp,
    },
  })
}
