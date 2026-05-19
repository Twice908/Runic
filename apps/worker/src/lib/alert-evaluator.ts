import pino from 'pino'
import { prisma, Prisma } from '@pulse/db'
import { redis } from './redis'
import { dispatch } from './notifications'

const logger = pino({ name: 'alert-evaluator' })

const DEBOUNCE_TTL_SECONDS = 300
const ERROR_RATE_WINDOW_MS = 5 * 60 * 1000
const RESPONSE_TIME_WINDOW_MS = 5 * 60 * 1000

export async function evaluateAlerts(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return

  const alerts = await prisma.alert.findMany({
    where: { projectId, active: true },
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

  if (!lastCheck || lastCheck.status !== 'down') return

  await fireAlert({
    alertId: alert.id,
    projectId: alert.projectId,
    projectName,
    alertType: 'uptime',
    channel: alert.channel as 'email' | 'slack',
    destination: alert.destination,
    triggeredValue: 0,
    threshold: 1,
    message: `Uptime check is DOWN. Last checked at ${lastCheck.checkedAt.toISOString()}.`,
  })
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

async function fireAlert(params: {
  alertId: string
  projectId: string
  projectName: string
  alertType: string
  channel: 'email' | 'slack'
  destination: string
  triggeredValue: number
  threshold: number
  message: string
}): Promise<void> {
  const debounceKey = `alert:debounce:${params.alertId}`
  const alreadyFired = await redis.get(debounceKey)
  if (alreadyFired) {
    logger.debug({ alertId: params.alertId }, 'Alert debounced — skipping')
    return
  }

  await dispatch(params)
  await redis.set(debounceKey, '1', 'EX', DEBOUNCE_TTL_SECONDS)
  logger.info({ alertId: params.alertId, type: params.alertType }, 'Alert fired')
}
