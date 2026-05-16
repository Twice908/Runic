import type { Job } from 'bullmq'
import pino from 'pino'
import type { IngestEvent } from '@pulse/types'

const logger = pino({ name: 'ingest-processor' })

export interface IngestJobData {
  events: IngestEvent[]
}

export async function processIngest(job: Job<IngestJobData>): Promise<void> {
  logger.info(
    { jobId: job.id, eventCount: job.data.events.length },
    'Processing ingest job',
  )
}
