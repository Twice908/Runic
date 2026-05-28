import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DriftEventType } from '@prisma/client'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { requireInternalToken } from '../middleware/auth'

const MILLIS_PER_DAY = 86_400_000

type KeyStatus = 'present' | 'missing' | 'extra' | 'stale' | 'ignored'

const patchBodySchema = z.object({
  description: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  rotationDays: z.number().int().positive().nullable().optional(),
  isIgnored: z.boolean().optional(),
  ignoreReason: z.string().nullable().optional(),
})

interface LatestManifestRow {
  environmentId: string
  keys: string[]
  capturedAt: Date
}

export async function keysRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { projectId: string } }>(
    '/keys/:projectId',
    { preHandler: requireInternalToken },
    async (request) => {
      const { projectId } = request.params

      const [metas, envs, openEvents, latestManifests] = await Promise.all([
        prisma.driftKeyMeta.findMany({ where: { projectId } }),
        prisma.driftEnvironment.findMany({
          where: { projectId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.driftEvent.findMany({
          where: { projectId, resolved: false },
          select: { keyName: true, environmentId: true, driftType: true },
        }),
        prisma.$queryRaw<LatestManifestRow[]>`
          SELECT DISTINCT ON ("environmentId")
            "environmentId", "keys", "capturedAt"
          FROM "DriftManifest"
          WHERE "projectId" = ${projectId}
          ORDER BY "environmentId", "capturedAt" DESC
        `,
      ])

      const envIdToName = new Map(envs.map((e) => [e.id, e.name]))

      const openByKey = new Map<string, Map<string, DriftEventType>>()
      for (const ev of openEvents) {
        const envName = envIdToName.get(ev.environmentId)
        if (!envName) continue
        let inner = openByKey.get(ev.keyName)
        if (!inner) {
          inner = new Map()
          openByKey.set(ev.keyName, inner)
        }
        inner.set(envName, ev.driftType)
      }

      const lastSeenByKey = new Map<string, Record<string, Date>>()
      for (const m of latestManifests) {
        const envName = envIdToName.get(m.environmentId)
        if (!envName) continue
        for (const k of m.keys) {
          let inner = lastSeenByKey.get(k)
          if (!inner) {
            inner = {}
            lastSeenByKey.set(k, inner)
          }
          inner[envName] = m.capturedAt
        }
      }

      const earliestCapturedByKey = new Map<string, Date>()
      for (const m of latestManifests) {
        for (const k of m.keys) {
          const cur = earliestCapturedByKey.get(k)
          if (!cur || m.capturedAt < cur) {
            earliestCapturedByKey.set(k, m.capturedAt)
          }
        }
      }

      const metaByKey = new Map(metas.map((m) => [m.keyName, m]))
      const allKeyNames = new Set<string>([
        ...metas.map((m) => m.keyName),
        ...earliestCapturedByKey.keys(),
      ])

      const now = Date.now()

      const buildStatusAndSeen = (
        keyName: string,
        isIgnored: boolean,
      ): {
        currentStatus: Record<string, KeyStatus>
        lastSeenAt: Record<string, Date | null>
      } => {
        const currentStatus: Record<string, KeyStatus> = {}
        const lastSeenAt: Record<string, Date | null> = {}
        const perEnvSeen = lastSeenByKey.get(keyName)

        for (const env of envs) {
          lastSeenAt[env.name] = perEnvSeen?.[env.name] ?? null

          if (isIgnored) {
            currentStatus[env.name] = 'ignored'
            continue
          }
          const drift = openByKey.get(keyName)?.get(env.name)
          if (drift === DriftEventType.MISSING_KEY) {
            currentStatus[env.name] = 'missing'
          } else if (drift === DriftEventType.EXTRA_KEY) {
            currentStatus[env.name] = 'extra'
          } else if (drift === DriftEventType.STALE_ROTATION) {
            currentStatus[env.name] = 'stale'
          } else if (perEnvSeen?.[env.name]) {
            currentStatus[env.name] = 'present'
          } else {
            currentStatus[env.name] = 'missing'
          }
        }

        return { currentStatus, lastSeenAt }
      }

      const merged = Array.from(allKeyNames).map((keyName) => {
        const meta = metaByKey.get(keyName)

        if (meta) {
          let daysOverdue: number | null = null
          if (meta.rotationDays !== null && meta.lastChangedAt !== null) {
            const daysSince = Math.floor(
              (now - meta.lastChangedAt.getTime()) / MILLIS_PER_DAY,
            )
            daysOverdue = Math.max(0, daysSince - meta.rotationDays)
          }

          const { currentStatus, lastSeenAt } = buildStatusAndSeen(
            meta.keyName,
            meta.isIgnored,
          )
          return { ...meta, currentStatus, daysOverdue, lastSeenAt }
        }

        const { currentStatus, lastSeenAt } = buildStatusAndSeen(keyName, false)
        return {
          keyName,
          description: null,
          owner: null,
          rotationDays: null,
          isIgnored: false,
          ignoreReason: null,
          firstSeenAt: earliestCapturedByKey.get(keyName) ?? null,
          lastChangedAt: null,
          daysOverdue: null,
          currentStatus,
          lastSeenAt,
        }
      })

      merged.sort((a, b) => a.keyName.localeCompare(b.keyName))
      return merged
    },
  )

  app.patch<{ Params: { projectId: string; keyName: string } }>(
    '/keys/:projectId/:keyName',
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const { projectId, keyName } = request.params

      const parsed = patchBodySchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_BODY',
            message: parsed.error.issues[0]?.message ?? 'Invalid body',
          },
        })
      }
      const data = parsed.data

      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.driftKeyMeta.findFirst({
          where: { projectId, keyName, environmentId: null },
        })
        if (existing) {
          return tx.driftKeyMeta.update({
            where: { id: existing.id },
            data,
          })
        }
        return tx.driftKeyMeta.create({
          data: {
            projectId,
            keyName,
            environmentId: null,
            ...data,
          },
        })
      })

      if (data.isIgnored === true) {
        await prisma.driftEvent.updateMany({
          where: { projectId, keyName, resolved: false },
          data: { resolved: true, resolvedAt: new Date() },
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
