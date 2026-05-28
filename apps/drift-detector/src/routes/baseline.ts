import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { requireInternalToken } from '../middleware/auth'
import { driftDiffQueue } from '../lib/queue'

const baselineBodySchema = z.object({
  environment: z.string().min(1).max(64),
})

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { projectId: string } }>(
    '/baseline/:projectId',
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const { projectId } = request.params

      const parsed = baselineBodySchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_BODY',
            message: parsed.error.issues[0]?.message ?? 'Invalid body',
          },
        })
      }
      const { environment } = parsed.data

      const target = await prisma.driftEnvironment.findUnique({
        where: { projectId_name: { projectId, name: environment } },
        select: { id: true },
      })
      if (!target) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Environment not found' },
        })
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.driftEnvironment.updateMany({
          where: { projectId, isBaseline: true },
          data: { isBaseline: false },
        })
        return tx.driftEnvironment.update({
          where: { id: target.id },
          data: { isBaseline: true, driftScore: 100, lastSeenAt: new Date() },
        })
      })

      const otherEnvs = await prisma.driftEnvironment.findMany({
        where: { projectId, id: { not: target.id } },
        select: { id: true },
      })

      for (const env of otherEnvs) {
        const latestManifest = await prisma.driftManifest.findFirst({
          where: { environmentId: env.id },
          orderBy: { capturedAt: 'desc' },
          select: { id: true },
        })
        if (!latestManifest) continue
        await driftDiffQueue.add('diff', {
          manifestId: latestManifest.id,
          projectId,
          environmentId: env.id,
        })
      }

      try {
        await redis.del(`matrix:${projectId}`)
      } catch {
        // cache eviction failures must never crash the request
      }

      return updated
    },
  )
}
