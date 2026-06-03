import './env-loader'
import { Worker, Queue } from 'bullmq'
import pino from 'pino'
import { env } from './env'
import { processIngest } from './processors/ingest.processor'
import { processUptimeCheck } from './processors/uptime.processor'
import { processObserveAlertsCheck } from './processors/observe-alerts.processor'
import { processRateLimitEvent } from './processors/rate-limit-event.processor'
import { startAgentSpanWorker } from './processors/agent-span.processor'
import { processAgentAlertsCheck } from './processors/agent-alerts.processor'

const logger = pino({ name: 'worker', level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const UPTIME_JOB_NAME = 'uptime-check'
const UPTIME_REPEAT_MS = 60_000

const OBSERVE_ALERTS_JOB_NAME = 'observe-alerts-check'
const OBSERVE_ALERTS_REPEAT_MS = 60_000

const AGENT_ALERTS_JOB_NAME = 'agent-alerts-check'
const AGENT_ALERTS_REPEAT_MS = 5 * 60_000

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

// ── Observe alerts repeatable worker ─────────────────────────────────────────
const observeAlertsQueue = new Queue('observe-alerts', { connection })

const observeAlertsWorker = new Worker(
  'observe-alerts',
  async () => {
    await processObserveAlertsCheck()
  },
  { connection, concurrency: 1 },
)

observeAlertsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Observe-alerts job failed')
})

async function registerObserveAlertsJob(): Promise<void> {
  const repeatableJobs = await observeAlertsQueue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.name === OBSERVE_ALERTS_JOB_NAME) {
      await observeAlertsQueue.removeRepeatableByKey(job.key)
      logger.info({ key: job.key }, 'Removed stale observe-alerts repeatable job')
    }
  }

  await observeAlertsQueue.add(OBSERVE_ALERTS_JOB_NAME, {}, { repeat: { every: OBSERVE_ALERTS_REPEAT_MS } })
  logger.info({ repeatEveryMs: OBSERVE_ALERTS_REPEAT_MS }, 'Observe-alerts repeatable job registered')
}

registerObserveAlertsJob().catch((err: unknown) => {
  logger.error({ err }, 'Failed to register observe-alerts repeatable job')
})

// ── Rate-limit-event worker ───────────────────────────────────────────────────
const rateLimitEventWorker = new Worker('rate-limit-events', processRateLimitEvent, {
  connection,
  concurrency: 10,
})

rateLimitEventWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id }, 'Rate-limit-event job completed')
})

rateLimitEventWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message, stack: err.stack }, 'Rate-limit-event job failed')
})

// ── Agent-alerts repeatable worker ────────────────────────────────────────────
const agentAlertsQueue = new Queue('agent-alerts', { connection })

const agentAlertsWorker = new Worker(
  'agent-alerts',
  async () => {
    await processAgentAlertsCheck()
  },
  { connection, concurrency: 1 },
)

agentAlertsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Agent-alerts job failed')
})

async function registerAgentAlertsJob(): Promise<void> {
  const repeatableJobs = await agentAlertsQueue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.name === AGENT_ALERTS_JOB_NAME) {
      await agentAlertsQueue.removeRepeatableByKey(job.key)
      logger.info({ key: job.key }, 'Removed stale agent-alerts repeatable job')
    }
  }

  await agentAlertsQueue.add(AGENT_ALERTS_JOB_NAME, {}, { repeat: { every: AGENT_ALERTS_REPEAT_MS } })
  logger.info({ repeatEveryMs: AGENT_ALERTS_REPEAT_MS }, 'Agent-alerts repeatable job registered')
}

registerAgentAlertsJob().catch((err: unknown) => {
  logger.error({ err }, 'Failed to register agent-alerts repeatable job')
})

// ── Agent-span worker ─────────────────────────────────────────────────────────
startAgentSpanWorker(connection)

logger.info('Worker started — ingest + uptime + observe-alerts + rate-limit-events + agent-spans + agent-alerts queues active')
