import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
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

    const parsed = ingestBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    await ingestQueue.add('process', { events: parsed.data.events })

    return reply.send({ success: true })
  })
}
