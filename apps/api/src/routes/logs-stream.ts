import type { FastifyInstance } from 'fastify'
import IORedis from 'ioredis'
import { prisma } from '@pulse/db'
import { verifyClerkJwt } from '../lib/auth'
import { env } from '../env'

const HEARTBEAT_INTERVAL_MS = 30_000
const INITIAL_LOG_LIMIT = 50

async function getOwnedProject(clerkId: string, projectId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return null
  return prisma.project.findFirst({ where: { id: projectId, userId: user.id } })
}

export async function logsStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:projectId/logs/stream', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      })
    }

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const write = (chunk: string) => {
      if (!res.writableEnded) res.write(chunk)
    }

    const initialLogs = await prisma.requestLog.findMany({
      where: { projectId },
      orderBy: { timestamp: 'desc' },
      take: INITIAL_LOG_LIMIT,
    })

    for (const log of initialLogs.reverse()) {
      const payload = JSON.stringify({
        id: log.id,
        method: log.method,
        route: log.route,
        statusCode: log.statusCode,
        responseTime: log.responseTime,
        timestamp: log.timestamp.toISOString(),
      })
      write(`data: ${payload}\n\n`)
    }

    const subscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
    await subscriber.subscribe(`logs:${projectId}`)

    subscriber.on('message', (_channel: string, message: string) => {
      write(`data: ${message}\n\n`)
    })

    const heartbeat = setInterval(() => write(': heartbeat\n\n'), HEARTBEAT_INTERVAL_MS)

    res.on('close', () => {
      clearInterval(heartbeat)
      subscriber.unsubscribe().finally(() => subscriber.disconnect())
    })
  })
}
