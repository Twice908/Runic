import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../plugins/prisma'
import { requireInternalToken } from '../middleware/auth'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const eventsQuerySchema = z.object({
  ruleId: z.string().optional(),
  action: z.enum(['blocked', 'logged']).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
})

const hitRateQuerySchema = z.object({
  window: z.enum(['1h', '6h', '24h', '7d']).default('24h'),
  bucket: z.enum(['hour', 'day']).default('hour'),
  ruleId: z.string().optional(),
})

const topOffendersQuerySchema = z.object({
  window: z.enum(['1h', '6h', '24h', '7d']).default('24h'),
  limit: z.coerce.number().int().positive().max(100).default(10),
  ruleId: z.string().optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function windowToMs(window: string): number {
  const map: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  return map[window] ?? 24 * 60 * 60 * 1000
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireInternalToken)

  // GET /v1/analytics/:projectId/stats
  // Overview stats used by the dashboard overview page.
  app.get<{ Params: { projectId: string } }>(
    '/analytics/:projectId/stats',
    async (request, reply) => {
      const { projectId } = request.params
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const [totalRules, enabledRules, blockedRow, loggedRow] = await Promise.all([
        prisma.rateLimitRule.count({ where: { projectId } }),
        prisma.rateLimitRule.count({ where: { projectId, enabled: true } }),
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM "RateLimitEvent"
          WHERE "projectId" = ${projectId}
            AND action = 'blocked'
            AND timestamp >= ${since24h}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count
          FROM "RateLimitEvent"
          WHERE "projectId" = ${projectId}
            AND action = 'logged'
            AND timestamp >= ${since24h}
        `,
      ])

      return reply.send({
        success: true,
        data: {
          totalRules,
          enabledRules,
          blockedLast24h: Number(blockedRow[0]?.count ?? 0),
          loggedLast24h: Number(loggedRow[0]?.count ?? 0),
        },
      })
    },
  )

  // GET /v1/analytics/:projectId/events
  // Paginated event feed with optional filters.
  app.get<{ Params: { projectId: string } }>(
    '/analytics/:projectId/events',
    async (request, reply) => {
      const { projectId } = request.params

      const parsed = eventsQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        })
      }

      const { ruleId, action, since, until, page, limit } = parsed.data
      const offset = (page - 1) * limit

      const where = {
        projectId,
        ...(ruleId ? { ruleId } : {}),
        ...(action ? { action } : {}),
        ...(since || until
          ? {
              timestamp: {
                ...(since ? { gte: new Date(since) } : {}),
                ...(until ? { lte: new Date(until) } : {}),
              },
            }
          : {}),
      }

      const [events, total] = await Promise.all([
        prisma.rateLimitEvent.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: offset,
          take: limit,
          include: { project: false },
        }),
        prisma.rateLimitEvent.count({ where }),
      ])

      // Attach rule names in a single lookup
      const ruleIds = [...new Set(events.map((e) => e.ruleId))]
      const rules = ruleIds.length
        ? await prisma.rateLimitRule.findMany({
            where: { id: { in: ruleIds } },
            select: { id: true, name: true },
          })
        : []
      const ruleNameById = Object.fromEntries(rules.map((r) => [r.id, r.name]))

      return reply.send({
        success: true,
        data: events.map((e) => ({
          id: e.id,
          projectId: e.projectId,
          ruleId: e.ruleId,
          ruleName: ruleNameById[e.ruleId] ?? null,
          limitKey: e.limitKey,
          path: e.path,
          action: e.action,
          timestamp: e.timestamp.toISOString(),
        })),
        meta: { page, limit, total, hasMore: offset + events.length < total },
      })
    },
  )

  // GET /v1/analytics/:projectId/hit-rate
  // Per-rule allowed/blocked counts bucketed by hour or day.
  app.get<{ Params: { projectId: string } }>(
    '/analytics/:projectId/hit-rate',
    async (request, reply) => {
      const { projectId } = request.params

      const parsed = hitRateQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        })
      }

      const { window, bucket, ruleId } = parsed.data
      const since = new Date(Date.now() - windowToMs(window))

      // Use Prisma's typed API instead of raw SQL — the events page (which
      // works) also uses findMany, so we know data is reachable this way.
      const events = await prisma.rateLimitEvent.findMany({
        where: {
          projectId,
          timestamp: { gte: since },
          ...(ruleId ? { ruleId } : {}),
        },
        select: { timestamp: true, ruleId: true, action: true },
      })

      // Truncate timestamps in UTC to match what date_trunc would produce
      function truncate(date: Date): Date {
        const d = new Date(date)
        if (bucket === 'day') d.setUTCHours(0, 0, 0, 0)
        else d.setUTCMinutes(0, 0, 0)
        return d
      }

      const grouped = new Map<
        string,
        { bucket: Date; ruleId: string; allowed: number; blocked: number }
      >()
      for (const ev of events) {
        const t = truncate(ev.timestamp)
        const key = `${t.toISOString()}|${ev.ruleId}`
        let entry = grouped.get(key)
        if (!entry) {
          entry = { bucket: t, ruleId: ev.ruleId, allowed: 0, blocked: 0 }
          grouped.set(key, entry)
        }
        if (ev.action === 'logged') entry.allowed++
        else if (ev.action === 'blocked') entry.blocked++
      }

      const rows = Array.from(grouped.values()).sort(
        (a, b) => a.bucket.getTime() - b.bucket.getTime(),
      )

      const ruleIds = [...new Set(rows.map((r) => r.ruleId))]
      const rules = ruleIds.length
        ? await prisma.rateLimitRule.findMany({
            where: { id: { in: ruleIds } },
            select: { id: true, name: true },
          })
        : []
      const ruleNameById = Object.fromEntries(rules.map((r) => [r.id, r.name]))

      return reply.send({
        success: true,
        data: rows.map((r) => ({
          bucket: r.bucket.toISOString(),
          ruleId: r.ruleId,
          ruleName: ruleNameById[r.ruleId] ?? r.ruleId,
          allowed: r.allowed,
          blocked: r.blocked,
        })),
      })
    },
  )

  // GET /v1/analytics/:projectId/top-offenders
  // Top N keys by block count within the given window.
  app.get<{ Params: { projectId: string } }>(
    '/analytics/:projectId/top-offenders',
    async (request, reply) => {
      const { projectId } = request.params

      const parsed = topOffendersQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        })
      }

      const { window, limit, ruleId } = parsed.data
      const since = new Date(Date.now() - windowToMs(window))
      const ruleFilter = ruleId ? Prisma.sql`AND "ruleId" = ${ruleId}` : Prisma.empty

      const rows = await prisma.$queryRaw<
        Array<{ limitKey: string; ruleId: string; blockCount: bigint; lastSeen: Date }>
      >`
        SELECT
          "limitKey",
          "ruleId",
          COUNT(*)              AS "blockCount",
          MAX(timestamp)        AS "lastSeen"
        FROM "RateLimitEvent"
        WHERE "projectId" = ${projectId}
          AND action = 'blocked'
          AND timestamp >= ${since}
          ${ruleFilter}
        GROUP BY "limitKey", "ruleId"
        ORDER BY "blockCount" DESC
        LIMIT ${limit}
      `

      const ruleIds = [...new Set(rows.map((r) => r.ruleId))]
      const rules = ruleIds.length
        ? await prisma.rateLimitRule.findMany({
            where: { id: { in: ruleIds } },
            select: { id: true, name: true },
          })
        : []
      const ruleNameById = Object.fromEntries(rules.map((r) => [r.id, r.name]))

      return reply.send({
        success: true,
        data: rows.map((r) => ({
          limitKey: r.limitKey,
          ruleId: r.ruleId,
          ruleName: ruleNameById[r.ruleId] ?? r.ruleId,
          blockCount: Number(r.blockCount),
          lastSeen: r.lastSeen.toISOString(),
        })),
      })
    },
  )
}
