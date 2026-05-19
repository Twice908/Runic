import pino from 'pino'
import { prisma } from '@pulse/db'
import { evaluateAlerts } from '../lib/alert-evaluator'

const logger = pino({ name: 'uptime-processor' })

const REQUEST_TIMEOUT_MS = 10_000

export async function processUptimeCheck(): Promise<void> {
  const alerts = await prisma.alert.findMany({
    where: { type: 'uptime', active: true, url: { not: null } },
    select: { id: true, projectId: true, url: true },
  })

  if (alerts.length === 0) return

  await Promise.all(alerts.map((alert) => pingAndRecord(alert.projectId, alert.url!)))
}

async function pingAndRecord(projectId: string, url: string): Promise<void> {
  const start = Date.now()
  let status: 'up' | 'down' = 'down'
  let responseTime: number | null = null
  let httpStatusCode = 0

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal })
      clearTimeout(timer)
      responseTime = Date.now() - start
      httpStatusCode = res.status
      status = res.ok ? 'up' : 'down'
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    responseTime = Date.now() - start
    logger.warn({ projectId, url, err: (err as Error).message }, 'Uptime ping failed')
  }

  await prisma.uptimeCheck.create({
    data: {
      projectId,
      url,
      status,
      responseTime,
      checkedAt: new Date(),
    },
  })

  logger.debug({ projectId, url, status, responseTime, httpStatusCode }, 'Uptime check recorded')

  await evaluateAlerts(projectId)
}
