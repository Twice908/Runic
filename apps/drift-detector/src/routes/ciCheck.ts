import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../plugins/prisma'
import { resolveProjectFromApiKey } from '../middleware/auth'

const querySchema = z.object({
  environment: z.string().min(1),
  ignoreKeys: z.string().optional(),
})

export async function ciCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ci-check/:projectId', async (request, reply) => {
    const project = await resolveProjectFromApiKey(request, reply)
    if (!project) return

    const params = request.params as { projectId: string }
    const projectId = params.projectId === 'self' ? project.id : params.projectId

    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(200).send({
        passed: false,
        missingKeys: [],
        extraKeys: [],
        driftScore: 0,
        baseline: null,
      })
    }
    const { environment, ignoreKeys: ignoreKeysRaw } = parsed.data

    const ignoreKeys = (ignoreKeysRaw ?? '')
      .split(',')
      .map((k) => k.trim().toUpperCase())
      .filter((k) => k.length > 0)

    const baseline = await prisma.driftEnvironment.findFirst({
      where: { projectId, isBaseline: true },
      select: { id: true, name: true },
    })

    if (!baseline) {
      return reply.status(200).send({
        passed: true,
        missingKeys: [],
        extraKeys: [],
        driftScore: 100,
        baseline: null,
      })
    }

    const baselineManifest = await prisma.driftManifest.findFirst({
      where: { environmentId: baseline.id },
      orderBy: { capturedAt: 'desc' },
      select: { keys: true },
    })
    const baselineKeys = baselineManifest?.keys ?? []

    const requestedEnv = await prisma.driftEnvironment.findUnique({
      where: { projectId_name: { projectId, name: environment } },
      select: { id: true, driftScore: true },
    })

    if (!requestedEnv) {
      const missingKeys = baselineKeys.filter((k) => !ignoreKeys.includes(k))
      return reply.status(200).send({
        passed: false,
        missingKeys,
        extraKeys: [],
        driftScore: 0,
        baseline: baseline.name,
      })
    }

    const envManifest = await prisma.driftManifest.findFirst({
      where: { environmentId: requestedEnv.id },
      orderBy: { capturedAt: 'desc' },
      select: { keys: true },
    })

    if (!envManifest) {
      const missingKeys = baselineKeys.filter((k) => !ignoreKeys.includes(k))
      return reply.status(200).send({
        passed: false,
        missingKeys,
        extraKeys: [],
        driftScore: requestedEnv.driftScore,
        baseline: baseline.name,
      })
    }

    const envKeysSet = new Set(envManifest.keys)
    const baselineKeysSet = new Set(baselineKeys)

    const missingKeys = baselineKeys
      .filter((k) => !envKeysSet.has(k))
      .filter((k) => !ignoreKeys.includes(k))

    const extraKeys = envManifest.keys
      .filter((k) => !baselineKeysSet.has(k))
      .filter((k) => !ignoreKeys.includes(k))

    return reply.status(200).send({
      passed: missingKeys.length === 0 && extraKeys.length === 0,
      missingKeys,
      extraKeys,
      driftScore: requestedEnv.driftScore,
      baseline: baseline.name,
    })
  })
}
