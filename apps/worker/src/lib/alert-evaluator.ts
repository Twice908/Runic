import pino from 'pino'
import { prisma, Prisma } from '@runic/db'
import { redis } from './redis'
import { dispatch } from './notifications'

const logger = pino({ name: 'alert-evaluator' })

const DEBOUNCE_TTL: Record<string, number> = {
  uptime: 300,
  error_rate: 600,
  response_time: 600,
  rate_limit_spike: 300,
}
const ERROR_RATE_WINDOW_MS = 5 * 60 * 1000
const RESPONSE_TIME_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_SPIKE_WINDOW_MS = 5 * 60 * 1000

export async function evaluateObserveAlerts(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return

  const alerts = await prisma.alert.findMany({
    where: { projectId, active: true, type: { in: ['error_rate', 'response_time'] } },
  })

  await Promise.all(
    alerts.map((alert) => evaluateSingleAlert(alert, project.name)),
  )
}

export async function evaluateUptimeAlerts(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return

  const alerts = await prisma.alert.findMany({
    where: { projectId, active: true, type: 'uptime' },
  })

  await Promise.all(
    alerts.map((alert) => evaluateSingleAlert(alert, project.name)),
  )
}

async function evaluateSingleAlert(
  alert: { id: string; projectId: string; type: string; threshold: number; channel: string; destination: string; url: string | null; route: string | null },
  projectName: string,
): Promise<void> {
  try {
    if (alert.type === 'uptime') {
      await evaluateUptime(alert, projectName)
    } else if (alert.type === 'error_rate') {
      await evaluateErrorRate(alert, projectName)
    } else if (alert.type === 'response_time') {
      await evaluateResponseTime(alert, projectName)
    } else if (alert.type === 'rate_limit_spike') {
      await evaluateRateLimitSpikeAlert(alert, projectName)
    }
  } catch (err) {
    logger.error({ alertId: alert.id, err }, 'Error evaluating alert')
  }
}

async function evaluateUptime(
  alert: { id: string; projectId: string; channel: string; destination: string },
  projectName: string,
): Promise<void> {
  const lastCheck = await prisma.uptimeCheck.findFirst({
    where: { projectId: alert.projectId },
    orderBy: { checkedAt: 'desc' },
  })

  const currentStatus: 'up' | 'down' = lastCheck?.status === 'down' ? 'down' : 'up'
  const stateKey = `alert:uptime:state:${alert.id}`
  const lastState = await redis.get(stateKey)

  // Always record current state so the next evaluation sees the transition correctly
  await redis.set(stateKey, currentStatus, 'EX', 3600)

  if (currentStatus === 'down' && (lastState === 'up' || lastState === null)) {
    // Transition up → down (or first-ever check that finds down): fire alert
    await fireAlert({
      alertId: alert.id,
      projectId: alert.projectId,
      projectName,
      alertType: 'uptime',
      channel: alert.channel as 'email' | 'slack',
      destination: alert.destination,
      triggeredValue: 0,
      threshold: 1,
      message: `Uptime check is DOWN. Last checked at ${lastCheck!.checkedAt.toISOString()}.`,
    })
  } else if (currentStatus === 'up' && lastState === 'down') {
    // Recovery: clear the debounce key so the next outage fires a fresh alert
    const debounceKey = `alert:debounce:${alert.id}`
    try {
      await redis.del(debounceKey)
    } catch (err) {
      logger.warn({ debounceKey, err }, 'Failed to clear debounce key on uptime recovery')
    }
    logger.info({ alertId: alert.id }, 'Uptime recovered — debounce key cleared')
  }
}

async function evaluateErrorRate(
  alert: { id: string; projectId: string; threshold: number; channel: string; destination: string },
  projectName: string,
): Promise<void> {
  const since = new Date(Date.now() - ERROR_RATE_WINDOW_MS)

  const rows = await prisma.$queryRaw<Array<{ total: bigint; errors: bigint }>>`
    SELECT
      COUNT(*)::bigint                                          AS total,
      COUNT(*) FILTER (WHERE "statusCode" >= 400)::bigint      AS errors
    FROM "RequestLog"
    WHERE "projectId" = ${alert.projectId}
      AND timestamp >= ${since}`

  const row = rows[0]
  if (!row || Number(row.total) === 0) return

  const errorRate = (Number(row.errors) / Number(row.total)) * 100
  if (errorRate <= alert.threshold) return

  await fireAlert({
    alertId: alert.id,
    projectId: alert.projectId,
    projectName,
    alertType: 'error_rate',
    channel: alert.channel as 'email' | 'slack',
    destination: alert.destination,
    triggeredValue: Math.round(errorRate * 100) / 100,
    threshold: alert.threshold,
    message: `Error rate is ${errorRate.toFixed(1)}% over the last 5 minutes (threshold: ${alert.threshold}%).`,
  })
}

async function evaluateResponseTime(
  alert: { id: string; projectId: string; threshold: number; channel: string; destination: string; route: string | null },
  projectName: string,
): Promise<void> {
  const since = new Date(Date.now() - RESPONSE_TIME_WINDOW_MS)
  const routeFilter = alert.route ? Prisma.sql`AND route = ${alert.route}` : Prisma.empty

  const rows = await prisma.$queryRaw<Array<{ p99: number | null }>>`
    SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY "responseTime") AS p99
    FROM "RequestLog"
    WHERE "projectId" = ${alert.projectId}
      AND timestamp >= ${since}
      ${routeFilter}`

  const p99 = rows[0]?.p99 ?? null
  if (p99 === null || p99 <= alert.threshold) return

  const routeLabel = alert.route ? ` on route ${alert.route}` : ''
  await fireAlert({
    alertId: alert.id,
    projectId: alert.projectId,
    projectName,
    alertType: 'response_time',
    channel: alert.channel as 'email' | 'slack',
    destination: alert.destination,
    triggeredValue: Math.round(p99),
    threshold: alert.threshold,
    message: `P99 response time${routeLabel} is ${Math.round(p99)}ms over the last 5 minutes (threshold: ${alert.threshold}ms).`,
  })
}

// ── Rate Limiter alert evaluation ─────────────────────────────────────────────

/**
 * Entry point called by the rate-limit-event processor after each batch write.
 * Only evaluates rate_limit_spike alerts — never re-evaluates Observe alert types.
 */
export async function evaluateRateLimitAlerts(projectId: string): Promise<void> {
  const lockKey = `rl:eval:lock:${projectId}`
  const lock = await redis.set(lockKey, '1', 'NX', 'EX', 5)
  if (!lock) {
    logger.debug({ projectId }, 'Rate limit evaluation already running — skipping')
    return
  }

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return

    const alerts = await prisma.alert.findMany({
      where: { projectId, active: true, type: 'rate_limit_spike' },
    })

    logger.debug({ projectId, alertCount: alerts.length }, 'Rate limit alerts to evaluate')

    await Promise.all(
      alerts.map((alert) => evaluateSingleAlert(alert, project.name)),
    )
  } finally {
    await redis.del(lockKey)
  }
}

async function evaluateRateLimitSpikeAlert(
  alert: { id: string; projectId: string; threshold: number; channel: string; destination: string },
  projectName: string,
): Promise<void> {
  await evaluateBlockSpike(alert, projectName)
}

async function evaluateBlockSpike(
  alert: { id: string; projectId: string; threshold: number; channel: string; destination: string },
  projectName: string,
): Promise<void> {
  const since = new Date(Date.now() - RATE_LIMIT_SPIKE_WINDOW_MS)

  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM "RateLimitEvent"
    WHERE "projectId" = ${alert.projectId}
      AND action = 'blocked'
      AND timestamp >= ${since}
  `

  const blockCount = Number(rows[0]?.count ?? 0)
  logger.debug({ projectId: alert.projectId, blockCount, threshold: alert.threshold }, 'Block spike check')
  if (blockCount <= alert.threshold) return

  await fireAlert({
    alertId: alert.id,
    debounceId: `${alert.id}:spike`,
    projectId: alert.projectId,
    projectName,
    alertType: 'rate_limit_spike',
    channel: alert.channel as 'email' | 'slack',
    destination: alert.destination,
    triggeredValue: blockCount,
    threshold: alert.threshold,
    message: `Rate limit spike: ${blockCount} requests blocked in the last 5 minutes (threshold: ${alert.threshold}).`,
  })
}

async function fireAlert(params: {
  alertId: string      // real Alert.id — used for DB FK write in dispatch()
  debounceId?: string  // optional override for the Redis debounce key (use when alertId is composite)
  projectId: string
  projectName: string
  alertType: string
  channel: 'email' | 'slack'
  destination: string
  triggeredValue: number
  threshold: number
  message: string
}): Promise<void> {
  const debounceKey = `alert:debounce:${params.debounceId ?? params.alertId}`
  const ttl = DEBOUNCE_TTL[params.alertType] ?? 600
  const acquired = await redis.set(debounceKey, '1', 'EX', ttl, 'NX')
  if (!acquired) {
    logger.debug({ alertId: params.alertId }, 'Alert debounced — skipping')
    return
  }
  await dispatch(params)
  logger.info({ alertId: params.alertId, type: params.alertType }, 'Alert fired')
}
