import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, Prisma } from '@pulse/db'
import { verifyClerkJwt } from '../lib/auth'

const rangeSchema = z.enum(['1h', '6h', '24h', '7d'])
type Range = z.infer<typeof rangeSchema>

const INTERVAL: Record<Range, string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
  '7d': '7 days',
}

// Bucket sizes in seconds — used with epoch-floor math so time_bucket() (TimescaleDB)
// is not required; plain PostgreSQL's to_timestamp + floor + extract works identically.
const BUCKET_SECONDS: Record<Range, number> = {
  '1h': 300,    // 5 minutes
  '6h': 1800,   // 30 minutes
  '24h': 3600,  // 1 hour
  '7d': 86400,  // 1 day
}

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

const PAGE_SIZE = 20

async function getOwnedProject(clerkId: string, projectId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return null
  return prisma.project.findFirst({ where: { id: projectId, userId: user.id } })
}

function parseRange(raw: unknown): { ok: true; range: Range } | { ok: false } {
  const result = rangeSchema.safeParse(raw ?? '24h')
  return result.success ? { ok: true, range: result.data } : { ok: false }
}

// Raw query row shapes — all numeric columns are cast in SQL to avoid BigInt/Decimal.
interface VolumeRow { bucket: Date; count: number; errorCount: number }
interface LatencyRow { bucket: Date; p50: number | null; p90: number | null; p99: number | null }
interface TopRouteRow {
  route: string
  method: string
  requestCount: number
  errorCount: number
  avgLatency: number
  p99Latency: number | null
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // ── Volume ──────────────────────────────────────────────────────────────────
  // Uses epoch-floor bucketing (plain PostgreSQL) instead of time_bucket() so
  // TimescaleDB is not required.
  app.get('/projects/:projectId/analytics/volume', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const qp = request.query as Record<string, string>
    const parsed = parseRange(qp['range'])
    if (!parsed.ok) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_RANGE', message: 'range must be 1h | 6h | 24h | 7d' } })
    }
    const { range } = parsed

    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const since = Prisma.raw(`NOW() - INTERVAL '${INTERVAL[range]}'`)
    const bSecs = Prisma.raw(String(BUCKET_SECONDS[range]))

    const rows = await prisma.$queryRaw<VolumeRow[]>`
      SELECT
        to_timestamp(floor(extract(epoch from timestamp) / ${bSecs}) * ${bSecs}) AS bucket,
        COUNT(*)::int4                                                            AS count,
        COUNT(*) FILTER (WHERE "statusCode" >= 400)::int4                        AS "errorCount"
      FROM "RequestLog"
      WHERE "projectId" = ${projectId}
        AND timestamp >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC`

    return reply.send({
      success: true,
      data: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        count: r.count,
        errorCount: r.errorCount,
      })),
    })
  })

  // ── Latency Percentiles ──────────────────────────────────────────────────────
  // percentile_cont is not aggregatable, so always queries RequestLog directly.
  // The composite index on (projectId, timestamp) keeps this fast.
  app.get('/projects/:projectId/analytics/latency', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const qp = request.query as Record<string, string>
    const parsed = parseRange(qp['range'])
    if (!parsed.ok) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_RANGE', message: 'range must be 1h | 6h | 24h | 7d' } })
    }
    const { range } = parsed

    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const since = Prisma.raw(`NOW() - INTERVAL '${INTERVAL[range]}'`)
    const bSecs = Prisma.raw(String(BUCKET_SECONDS[range]))
    const routeFilter = qp['route'] ? Prisma.sql`AND route = ${qp['route']}` : Prisma.empty

    const rows = await prisma.$queryRaw<LatencyRow[]>`
      SELECT
        to_timestamp(floor(extract(epoch from timestamp) / ${bSecs}) * ${bSecs}) AS bucket,
        percentile_cont(0.5)  WITHIN GROUP (ORDER BY "responseTime")             AS p50,
        percentile_cont(0.9)  WITHIN GROUP (ORDER BY "responseTime")             AS p90,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "responseTime")             AS p99
      FROM "RequestLog"
      WHERE "projectId" = ${projectId}
        AND timestamp >= ${since}
        ${routeFilter}
      GROUP BY bucket
      ORDER BY bucket ASC`

    return reply.send({
      success: true,
      data: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        p50: r.p50 ?? 0,
        p90: r.p90 ?? 0,
        p99: r.p99 ?? 0,
      })),
    })
  })

  // ── Top Routes ───────────────────────────────────────────────────────────────
  // Needs p99Latency so queries raw data (one bounded pass on the hypertable).
  app.get('/projects/:projectId/analytics/top-routes', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const qp = request.query as Record<string, string>
    const parsed = parseRange(qp['range'])
    if (!parsed.ok) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_RANGE', message: 'range must be 1h | 6h | 24h | 7d' } })
    }
    const { range } = parsed

    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const since = Prisma.raw(`NOW() - INTERVAL '${INTERVAL[range]}'`)

    const rows = await prisma.$queryRaw<TopRouteRow[]>`
      SELECT
        route,
        method,
        count(*)::int4                                                              AS "requestCount",
        (count(*) FILTER (WHERE "statusCode" >= 400))::int4                        AS "errorCount",
        avg("responseTime")::float8                                                 AS "avgLatency",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "responseTime")               AS "p99Latency"
      FROM "RequestLog"
      WHERE "projectId" = ${projectId}
        AND timestamp >= ${since}
      GROUP BY route, method
      ORDER BY "requestCount" DESC
      LIMIT 10`

    return reply.send({
      success: true,
      data: rows.map((r) => ({
        route: r.route,
        method: r.method,
        requestCount: r.requestCount,
        errorRate: r.requestCount > 0 ? (r.errorCount / r.requestCount) * 100 : 0,
        avgLatency: r.avgLatency ?? 0,
        p99Latency: r.p99Latency ?? 0,
      })),
    })
  })

  // ── Errors ───────────────────────────────────────────────────────────────────
  // Reads the ErrorEvent table directly — it already has denormalised counts.
  app.get('/projects/:projectId/analytics/errors', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const qp = request.query as Record<string, string>
    const parsed = parseRange(qp['range'])
    if (!parsed.ok) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_RANGE', message: 'range must be 1h | 6h | 24h | 7d' } })
    }
    const { range } = parsed
    const page = Math.max(0, parseInt(qp['page'] ?? '0', 10))

    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const since = new Date(Date.now() - RANGE_MS[range])
    const viewParam = (qp['view'] ?? 'open') as string

    // Build resolved filter: 'open' → false only, 'resolved' → true only, 'all' → no filter
    const resolvedFilter: { resolved?: boolean } = {}
    if (viewParam === 'open') resolvedFilter.resolved = false
    else if (viewParam === 'resolved') resolvedFilter.resolved = true

    const baseWhere = { projectId, lastSeen: { gte: since }, ...resolvedFilter }

    const [errors, total] = await Promise.all([
      prisma.errorEvent.findMany({
        where: baseWhere,
        orderBy: [{ count: 'desc' }, { lastSeen: 'desc' }],
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.errorEvent.count({ where: baseWhere }),
    ])

    return reply.send({
      success: true,
      data: errors.map((e) => ({
        id: e.id,
        message: e.message,
        route: e.route,
        statusCode: e.statusCode,
        count: e.count,
        firstSeen: e.firstSeen.toISOString(),
        lastSeen: e.lastSeen.toISOString(),
        resolved: e.resolved,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        ...(e.stack ? { stack: e.stack } : {}),
      })),
      total,
      page,
      hasMore: (page + 1) * PAGE_SIZE < total,
    })
  })

  // ── Resolve error group ──────────────────────────────────────────────────────
  app.patch('/projects/:projectId/errors/:errorId/resolve', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId, errorId } = request.params as { projectId: string; errorId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const existing = await prisma.errorEvent.findFirst({ where: { id: errorId, projectId } })
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Error group not found' } })

    const updated = await prisma.errorEvent.update({
      where: { id: errorId },
      data: { resolved: true, resolvedAt: new Date() },
    })

    return reply.send({ success: true, data: { id: updated.id, resolved: updated.resolved, resolvedAt: updated.resolvedAt?.toISOString() } })
  })

  // ── Unresolve error group ────────────────────────────────────────────────────
  app.patch('/projects/:projectId/errors/:errorId/unresolve', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId, errorId } = request.params as { projectId: string; errorId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const existing = await prisma.errorEvent.findFirst({ where: { id: errorId, projectId } })
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Error group not found' } })

    const updated = await prisma.errorEvent.update({
      where: { id: errorId },
      data: { resolved: false, resolvedAt: null },
    })

    return reply.send({ success: true, data: { id: updated.id, resolved: updated.resolved, resolvedAt: null } })
  })
}
