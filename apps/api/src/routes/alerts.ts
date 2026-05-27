import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { verifyClerkJwt } from '../lib/auth'
import { env } from '../env'

const ALERT_TYPES = ['uptime', 'error_rate', 'response_time', 'rate_limit_spike', 'drift_detected', 'key_missing_in_env', 'rotation_overdue'] as const
const ALERT_CHANNELS = ['email', 'slack'] as const

const createAlertSchema = z
  .object({
    type: z.enum(ALERT_TYPES),
    channel: z.enum(ALERT_CHANNELS),
    destination: z.string().min(1),
    threshold: z.number().min(0),
    url: z.string().url().optional(),
    route: z.string().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'uptime' && !val.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'url is required for uptime alerts', path: ['url'] })
    }
    if (val.channel === 'email' && !z.string().email().safeParse(val.destination).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'destination must be a valid email address', path: ['destination'] })
    }
    if (val.channel === 'slack' && !val.destination.startsWith('https://hooks.slack.com/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'destination must be a Slack webhook URL (https://hooks.slack.com/...)', path: ['destination'] })
    }
  })

const patchAlertSchema = z.object({
  active: z.boolean().optional(),
  threshold: z.number().min(0).optional(),
  destination: z.string().min(1).optional(),
  url: z.string().url().optional(),
})

const PAGE_SIZE = 20

async function getOwnedProject(clerkId: string, projectId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return null
  return prisma.project.findFirst({ where: { id: projectId, userId: user.id } })
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /projects/:projectId/alerts ──────────────────────────────────────
  app.get('/projects/:projectId/alerts', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const alerts = await prisma.alert.findMany({
      where: { projectId },
      include: {
        events: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'desc' },
    })

    return reply.send({
      success: true,
      data: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        channel: a.channel,
        destination: a.destination,
        threshold: a.threshold,
        url: a.url ?? undefined,
        route: a.route ?? undefined,
        active: a.active,
        lastFired: a.events[0]?.sentAt.toISOString() ?? undefined,
      })),
    })
  })

  // ── POST /projects/:projectId/alerts ─────────────────────────────────────
  app.post('/projects/:projectId/alerts', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const parsed = createAlertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } })
    }

    const alert = await prisma.alert.create({
      data: {
        projectId,
        type: parsed.data.type,
        channel: parsed.data.channel,
        destination: parsed.data.destination,
        threshold: parsed.data.threshold,
        url: parsed.data.url ?? null,
        route: parsed.data.route ?? null,
        active: parsed.data.active,
      },
    })

    return reply.status(201).send({
      success: true,
      data: {
        id: alert.id,
        type: alert.type,
        channel: alert.channel,
        destination: alert.destination,
        threshold: alert.threshold,
        url: alert.url ?? undefined,
        route: alert.route ?? undefined,
        active: alert.active,
      },
    })
  })

  // ── PATCH /projects/:projectId/alerts/:alertId ───────────────────────────
  app.patch('/projects/:projectId/alerts/:alertId', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId, alertId } = request.params as { projectId: string; alertId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const parsed = patchAlertSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } })
    }

    const existing = await prisma.alert.findFirst({ where: { id: alertId, projectId } })
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } })

    const updated = await prisma.alert.update({
      where: { id: alertId },
      data: parsed.data,
    })

    return reply.send({
      success: true,
      data: {
        id: updated.id,
        type: updated.type,
        channel: updated.channel,
        destination: updated.destination,
        threshold: updated.threshold,
        url: updated.url ?? undefined,
        route: updated.route ?? undefined,
        active: updated.active,
      },
    })
  })

  // ── DELETE /projects/:projectId/alerts/:alertId ──────────────────────────
  app.delete('/projects/:projectId/alerts/:alertId', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId, alertId } = request.params as { projectId: string; alertId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const existing = await prisma.alert.findFirst({ where: { id: alertId, projectId } })
    if (!existing) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } })

    await prisma.alert.delete({ where: { id: alertId } })

    return reply.send({ success: true })
  })

  // ── GET /projects/:projectId/alerts/history ──────────────────────────────
  app.get('/projects/:projectId/alerts/history', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const qp = request.query as Record<string, string>
    const page = Math.max(1, parseInt(qp['page'] ?? '1', 10))
    const limit = Math.min(100, parseInt(qp['limit'] ?? String(PAGE_SIZE), 10))

    const [events, total] = await Promise.all([
      prisma.alertEvent.findMany({
        where: { projectId },
        include: { alert: { select: { type: true, channel: true } } },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.alertEvent.count({ where: { projectId } }),
    ])

    return reply.send({
      success: true,
      data: events.map((e) => ({
        id: e.id,
        alertId: e.alertId,
        type: e.type,
        triggeredValue: e.triggeredValue,
        threshold: e.threshold,
        message: e.message,
        channel: e.channel,
        sentAt: e.sentAt.toISOString(),
      })),
      total,
      page,
      hasMore: page * limit < total,
    })
  })

  // ── POST /projects/:projectId/alerts/:alertId/test ───────────────────────
  app.post('/projects/:projectId/alerts/:alertId/test', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId, alertId } = request.params as { projectId: string; alertId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const alert = await prisma.alert.findFirst({ where: { id: alertId, projectId } })
    if (!alert) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } })

    try {
      if (alert.channel === 'email') {
        if (!env.RESEND_API_KEY) {
          return reply.status(502).send({
            success: false,
            error: { code: 'CHANNEL_ERROR', message: 'RESEND_API_KEY is not configured on this server' },
          })
        }
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: alert.destination,
            subject: 'Test alert from Pulse',
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Test Notification</h2><p>This is a test notification. Your alert channel is configured correctly.</p><p style="color:#6b7280;font-size:14px">Alert type: ${alert.type} · Project: ${projectId}</p></div>`,
          }),
        })
        if (!res.ok) {
          const body = (await res.json()) as { message?: string }
          return reply.status(502).send({
            success: false,
            error: { code: 'CHANNEL_ERROR', message: body.message ?? `Resend returned ${res.status}` },
          })
        }
      } else if (alert.channel === 'slack') {
        const res = await fetch(alert.destination, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: 'Test alert from Pulse' } },
              { type: 'section', text: { type: 'mrkdwn', text: 'This is a test notification. Your alert channel is configured correctly.' } },
              { type: 'context', elements: [{ type: 'mrkdwn', text: `Alert type: ${alert.type} · Project: ${projectId}` }] },
            ],
          }),
        })
        if (!res.ok) {
          return reply.status(502).send({
            success: false,
            error: { code: 'CHANNEL_ERROR', message: `Slack webhook returned ${res.status}` },
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delivery failed'
      return reply.status(502).send({
        success: false,
        error: { code: 'CHANNEL_ERROR', message },
      })
    }

    return reply.send({ success: true })
  })

  // ── GET /projects/:projectId/uptime ──────────────────────────────────────
  app.get('/projects/:projectId/uptime', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } })

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const checks = await prisma.uptimeCheck.findMany({
      where: { projectId },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    })

    const checks24h = checks.filter((c) => c.checkedAt >= since24h)
    const upCount = checks24h.filter((c) => c.status === 'up').length
    const uptimePercent24h = checks24h.length > 0 ? (upCount / checks24h.length) * 100 : 100

    const responseTimes = checks24h.filter((c) => c.responseTime !== null).map((c) => c.responseTime!)
    const avgResponseTime24h =
      responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0

    const current = checks[0]?.status === 'down' ? 'down' : 'up'

    return reply.send({
      success: true,
      data: {
        current,
        uptimePercent24h: Math.round(uptimePercent24h * 100) / 100,
        avgResponseTime24h,
        checks: checks.map((c) => ({
          status: c.status,
          responseTime: c.responseTime ?? 0,
          checkedAt: c.checkedAt.toISOString(),
          httpStatusCode: 0,
        })),
      },
    })
  })
}
