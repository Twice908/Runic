import pino from 'pino'
import { prisma } from '@runic/db'
import { evaluateObserveAlerts } from '../lib/alert-evaluator'

const logger = pino({ name: 'observe-alerts-processor' })

export async function processObserveAlertsCheck(): Promise<void> {
  const rows = await prisma.alert.findMany({
    where: { active: true, type: { in: ['error_rate', 'response_time'] } },
    select: { projectId: true },
    distinct: ['projectId'],
  })

  if (rows.length === 0) return

  await Promise.all(
    rows.map(({ projectId }) =>
      evaluateObserveAlerts(projectId).catch((err: unknown) => {
        logger.error({ projectId, err }, 'Observe alert evaluation failed')
      }),
    ),
  )
}
