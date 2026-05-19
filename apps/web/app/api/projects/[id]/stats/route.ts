import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import type { ProjectStats } from '@pulse/types'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

async function getOwnedProject(clerkId: string, projectId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return null
  return prisma.project.findFirst({ where: { id: projectId, userId: user.id } })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await getOwnedProject(userId, params.id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 403 })

  const since24h = new Date(Date.now() - TWENTY_FOUR_HOURS_MS)

  const [totalRequests, requestsLast24h, errorRequests, avgData, activeErrors] =
    await Promise.all([
      prisma.requestLog.count({ where: { projectId: params.id } }),
      prisma.requestLog.count({ where: { projectId: params.id, timestamp: { gte: since24h } } }),
      prisma.requestLog.count({
        where: { projectId: params.id, timestamp: { gte: since24h }, statusCode: { gte: 400 } },
      }),
      prisma.requestLog.aggregate({
        where: { projectId: params.id, timestamp: { gte: since24h } },
        _avg: { responseTime: true },
      }),
      prisma.errorEvent.count({ where: { projectId: params.id } }),
    ])

  const errorRate = requestsLast24h > 0 ? (errorRequests / requestsLast24h) * 100 : 0

  const stats: ProjectStats = {
    totalRequests,
    requestsLast24h,
    errorRate: Math.round(errorRate * 10) / 10,
    avgResponseTime: Math.round(avgData._avg.responseTime ?? 0),
    activeErrors,
  }

  return NextResponse.json(stats)
}
