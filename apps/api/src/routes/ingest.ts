import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { hashApiKey } from '../lib/api-key'
import { isOverPlanLimit } from '../lib/plan-limits'
import { ingestQueue } from '../lib/queue'

const ingestEventSchema = z.object({
  method: z.string(),
  route: z.string(),
  statusCode: z.number().int().min(100).max(599),
  responseTime: z.number().int().min(0),
  timestamp: z.string().datetime(),
})

const ingestBodySchema = z.object({
  events: z.array(ingestEventSchema).min(1).max(100),
})

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ingest', async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' },
      })
    }

    const rawApiKey = authHeader.slice('Bearer '.length)
    const apiKeyHash = hashApiKey(rawApiKey)

    const project = await prisma.project.findUnique({
      where: { apiKeyHash },
      include: { user: { select: { plan: true } } },
    })

    if (!project) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      })
    }

    const parsed = ingestBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    const overLimit = await isOverPlanLimit(project.id, project.user.plan)
    if (overLimit) {
      return reply.status(402).send({
        success: false,
        error: {
          code: 'LIMIT_EXCEEDED',
          message: 'Monthly request limit reached. Please upgrade your plan.',
        },
      })
    }

    await ingestQueue.addBulk(
      parsed.data.events.map((event) => ({
        name: 'process',
        data: { ...event, projectId: project.id },
      })),
    )

    return reply.send({ success: true, queued: parsed.data.events.length })
  })
}
