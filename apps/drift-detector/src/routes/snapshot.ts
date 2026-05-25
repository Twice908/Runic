import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Plan } from '@pulse/db'
import { prisma } from '../plugins/prisma'
import { resolveProjectFromApiKey } from '../middleware/auth'
import { driftDiffQueue } from '../lib/queue'
import { maxKeysPerSnapshot } from '../env'

const PLAN_ENV_LIMITS: Record<Plan, number> = {
  FREE: 2,
  STARTER: 5,
  PRO: Number.MAX_SAFE_INTEGER,
  ENTERPRISE: Number.MAX_SAFE_INTEGER,
}

const snapshotBodySchema = z.object({
  environment: z.string().min(1).max(64),
  keys: z.array(z.string()),
  agentVersion: z.string().min(1),
  capturedAt: z.string().datetime(),
})

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

export async function snapshotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/snapshot', async (request, reply) => {
    const project = await resolveProjectFromApiKey(request, reply)
    if (!project) return

    const parsed = snapshotBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
      })
    }
    const { environment, keys, agentVersion, capturedAt } = parsed.data

    if (keys.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_KEYS', message: 'keys must be a non-empty array' },
      })
    }
    if (keys.length > maxKeysPerSnapshot) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'TOO_MANY_KEYS',
          message: `keys exceeds limit of ${maxKeysPerSnapshot}`,
        },
      })
    }
    if (keys.some((k) => k.includes('='))) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_KEY_FORMAT', message: 'keys must not contain "="' },
      })
    }

    const sanitizedKeys = Array.from(
      new Set(
        keys.map((k) => k.trim().toUpperCase()).filter((k) => KEY_PATTERN.test(k)),
      ),
    )

    const existing = await prisma.driftEnvironment.findUnique({
      where: { projectId_name: { projectId: project.id, name: environment } },
      select: { id: true },
    })

    if (!existing) {
      const projectRow = await prisma.project.findUnique({
        where: { id: project.id },
        select: { user: { select: { plan: true } } },
      })
      const plan = projectRow?.user?.plan ?? Plan.FREE
      const envLimit = PLAN_ENV_LIMITS[plan]
      const envCount = await prisma.driftEnvironment.count({
        where: { projectId: project.id },
      })
      if (envCount >= envLimit) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'PLAN_LIMIT_REACHED',
            message: `Plan ${plan} allows max ${envLimit} environments`,
          },
        })
      }
    }

    const driftEnv = await prisma.driftEnvironment.upsert({
      where: { projectId_name: { projectId: project.id, name: environment } },
      update: { lastSeenAt: new Date() },
      create: {
        projectId: project.id,
        name: environment,
        lastSeenAt: new Date(),
      },
      select: { id: true },
    })

    const manifest = await prisma.driftManifest.create({
      data: {
        environmentId: driftEnv.id,
        projectId: project.id,
        keys: sanitizedKeys,
        agentVersion,
        capturedAt: new Date(capturedAt),
      },
      select: { id: true },
    })

    const job = await driftDiffQueue.add('diff', {
      manifestId: manifest.id,
      projectId: project.id,
      environmentId: driftEnv.id,
    })

    return reply.status(202).send({
      received: true,
      driftJobId: job.id ?? manifest.id,
    })
  })
}
