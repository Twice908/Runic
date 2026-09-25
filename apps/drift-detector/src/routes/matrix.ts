import type { FastifyInstance } from 'fastify'
import { Prisma } from '@runic/db'
import { DriftEventType } from '@prisma/client'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { requireInternalToken } from '../middleware/auth'

const MATRIX_CACHE_TTL_SECS = 30
const matrixCacheKey = (projectId: string): string => `matrix:${projectId}`

type CellStatus = 'present' | 'missing' | 'extra' | 'stale' | 'ignored'

interface EnvironmentSummary {
  id: string
  name: string
  isBaseline: boolean
  driftScore: number
  lastSeenAt: string | null
}

interface MatrixRow {
  keyName: string
  cells: Record<string, CellStatus>
  firstSeenAt: string | null
}

interface MatrixResponse {
  environments: EnvironmentSummary[]
  rows: MatrixRow[]
}

interface LatestManifestRow {
  environmentId: string
  keys: string[]
  capturedAt: Date
}

export async function matrixRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { projectId: string } }>(
    '/matrix/:projectId',
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const { projectId } = request.params

      try {
        const cached = await redis.get(matrixCacheKey(projectId))
        if (cached) {
          reply.header('x-cache', 'hit')
          return JSON.parse(cached) as MatrixResponse
        }
      } catch {
        // redis miss/error — fall through to DB
      }

      const [envs, latestManifests, openEvents, metas] = await Promise.all([
        prisma.driftEnvironment.findMany({
          where: { projectId },
          select: { id: true, name: true, isBaseline: true, driftScore: true, lastSeenAt: true },
          orderBy: { name: 'asc' },
        }),
        prisma.$queryRaw<LatestManifestRow[]>(Prisma.sql`
          SELECT DISTINCT ON ("environmentId")
            "environmentId", "keys", "capturedAt"
          FROM "DriftManifest"
          WHERE "projectId" = ${projectId}
          ORDER BY "environmentId", "capturedAt" DESC
        `),
        prisma.driftEvent.findMany({
          where: {
            projectId,
            resolved: false,
            driftType: {
              in: [
                DriftEventType.MISSING_KEY,
                DriftEventType.EXTRA_KEY,
                DriftEventType.STALE_ROTATION,
              ],
            },
          },
          select: { environmentId: true, keyName: true, driftType: true },
        }),
        prisma.driftKeyMeta.findMany({
          where: { projectId },
          select: {
            keyName: true,
            environmentId: true,
            isIgnored: true,
            firstSeenAt: true,
          },
        }),
      ])

      const manifestKeysByEnvId = new Map<string, Set<string>>()
      for (const m of latestManifests) {
        manifestKeysByEnvId.set(m.environmentId, new Set(m.keys))
      }

      const ignoredGlobal = new Set<string>()
      const ignoredPerEnv = new Map<string, Set<string>>()
      const firstSeenByKey = new Map<string, Date>()
      for (const m of metas) {
        if (m.isIgnored) {
          if (m.environmentId === null) {
            ignoredGlobal.add(m.keyName)
          } else {
            let set = ignoredPerEnv.get(m.environmentId)
            if (!set) {
              set = new Set()
              ignoredPerEnv.set(m.environmentId, set)
            }
            set.add(m.keyName)
          }
        }
        if (m.firstSeenAt) {
          const prior = firstSeenByKey.get(m.keyName)
          if (!prior || m.firstSeenAt < prior) {
            firstSeenByKey.set(m.keyName, m.firstSeenAt)
          }
        }
      }

      const openByEnvKey = new Map<string, Map<string, DriftEventType>>()
      for (const e of openEvents) {
        let inner = openByEnvKey.get(e.environmentId)
        if (!inner) {
          inner = new Map()
          openByEnvKey.set(e.environmentId, inner)
        }
        inner.set(e.keyName, e.driftType)
      }

      const allKeys = new Set<string>()
      for (const keys of manifestKeysByEnvId.values()) {
        for (const k of keys) allKeys.add(k)
      }
      for (const inner of openByEnvKey.values()) {
        for (const k of inner.keys()) allKeys.add(k)
      }
      for (const k of ignoredGlobal) allKeys.add(k)
      for (const keys of ignoredPerEnv.values()) {
        for (const k of keys) allKeys.add(k)
      }
      const sortedKeys = [...allKeys].sort()

      const rows: MatrixRow[] = sortedKeys.map((key) => {
        const cells: Record<string, CellStatus> = {}
        for (const env of envs) {
          if (ignoredGlobal.has(key) || ignoredPerEnv.get(env.id)?.has(key)) {
            cells[env.name] = 'ignored'
            continue
          }
          const openType = openByEnvKey.get(env.id)?.get(key)
          if (openType === DriftEventType.MISSING_KEY) {
            cells[env.name] = 'missing'
          } else if (openType === DriftEventType.EXTRA_KEY) {
            cells[env.name] = 'extra'
          } else if (openType === DriftEventType.STALE_ROTATION) {
            cells[env.name] = 'stale'
          } else if (manifestKeysByEnvId.get(env.id)?.has(key)) {
            cells[env.name] = 'present'
          } else {
            cells[env.name] = 'missing'
          }
        }
        return {
          keyName: key,
          cells,
          firstSeenAt: firstSeenByKey.get(key)?.toISOString() ?? null,
        }
      })

      const response: MatrixResponse = {
        environments: envs.map((e) => ({
          id: e.id,
          name: e.name,
          isBaseline: e.isBaseline,
          driftScore: e.driftScore,
          lastSeenAt: e.lastSeenAt ? e.lastSeenAt.toISOString() : null,
        })),
        rows,
      }

      redis
        .setex(matrixCacheKey(projectId), MATRIX_CACHE_TTL_SECS, JSON.stringify(response))
        .catch(() => null)

      reply.header('x-cache', 'miss')
      return response
    },
  )
}
