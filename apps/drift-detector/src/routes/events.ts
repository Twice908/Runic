import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '../plugins/prisma'
import { requireInternalToken } from '../middleware/auth'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

interface EventsQuery {
  env?: string
  type?: string
  resolved?: string
  page?: string
  limit?: string
  from?: string
  to?: string
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 1) return fallback
  return n
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function parseIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { projectId: string }; Querystring: EventsQuery }>(
    '/events/:projectId',
    { preHandler: requireInternalToken },
    async (request) => {
      const { projectId } = request.params
      const { env, type, resolved, page, limit, from, to } = request.query

      const pageNum = parsePositiveInt(page, DEFAULT_PAGE)
      const limitNum = Math.min(parsePositiveInt(limit, DEFAULT_LIMIT), MAX_LIMIT)
      const resolvedBool = parseBoolean(resolved)
      const fromDate = parseIsoDate(from)
      const toDate = parseIsoDate(to)

      const where: Prisma.DriftEventWhereInput = { projectId }

      if (env) {
        where.environment = { name: env }
      }
      if (type) {
        where.driftType = type as Prisma.DriftEventWhereInput['driftType']
      }
      if (resolvedBool !== undefined) {
        where.resolved = resolvedBool
      }
      if (fromDate || toDate) {
        where.detectedAt = {}
        if (fromDate) where.detectedAt.gte = fromDate
        if (toDate) where.detectedAt.lte = toDate
      }

      const [events, total] = await Promise.all([
        prisma.driftEvent.findMany({
          where,
          include: { environment: { select: { name: true } } },
          orderBy: { detectedAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.driftEvent.count({ where }),
      ])

      return {
        events,
        total,
        page: pageNum,
        hasMore: pageNum * limitNum < total,
      }
    },
  )
}
