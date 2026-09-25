import { prisma } from '@runic/db'

const PLAN_REQUEST_LIMITS: Record<string, number> = {
  FREE: 50_000,
  STARTER: 1_000_000,
  PRO: 10_000_000,
  ENTERPRISE: Number.MAX_SAFE_INTEGER,
}

function getBillingPeriodStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
}

export async function isOverPlanLimit(projectId: string, plan: string): Promise<boolean> {
  const limit = PLAN_REQUEST_LIMITS[plan] ?? PLAN_REQUEST_LIMITS['FREE']

  if (limit === Number.MAX_SAFE_INTEGER) return false

  const billingPeriodStart = getBillingPeriodStart()

  const count = await prisma.requestLog.count({
    where: {
      projectId,
      timestamp: { gte: billingPeriodStart },
    },
  })

  return count >= limit
}
