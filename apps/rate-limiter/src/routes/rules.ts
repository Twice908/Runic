import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../plugins/prisma'
import { redis } from '../plugins/redis'
import { invalidateRulesCache } from '../lib/rule-cache'
import { requireInternalToken } from '../middleware/auth'
import type { RateLimitRuleRecord } from '@pulse/types'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createRuleSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  pathPattern: z.string().min(1).trim(),
  limitKey: z.enum(['ip', 'apiKey', 'userId', 'global']),
  limitKeyHeader: z.string().optional(),
  limitCount: z.number().int().positive(),
  windowSecs: z.number().int().positive(),
  action: z.enum(['block', 'log_only']),
  priority: z.number().int().default(0),
})

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  pathPattern: z.string().min(1).trim().optional(),
  limitKey: z.enum(['ip', 'apiKey', 'userId', 'global']).optional(),
  limitKeyHeader: z.string().nullable().optional(),
  limitCount: z.number().int().positive().optional(),
  windowSecs: z.number().int().positive().optional(),
  action: z.enum(['block', 'log_only']).optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
})

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  // All rules and analytics routes require the internal token
  app.addHook('preHandler', requireInternalToken)

  // GET /v1/rules/:projectId — list all rules for a project (including disabled)
  app.get<{ Params: { projectId: string } }>('/rules/:projectId', async (request, reply) => {
    const { projectId } = request.params

    const rules = await prisma.rateLimitRule.findMany({
      where: { projectId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    })

    return reply.send({
      success: true,
      data: rules as unknown as RateLimitRuleRecord[],
    })
  })

  // POST /v1/rules/:projectId — create a rule; reject 409 on (projectId, pathPattern, limitKey) duplicate
  app.post<{ Params: { projectId: string } }>('/rules/:projectId', async (request, reply) => {
    const { projectId } = request.params

    const parsed = createRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    const { name, pathPattern, limitKey, limitKeyHeader, limitCount, windowSecs, action, priority } =
      parsed.data

    // Idempotency guard: same (projectId, pathPattern, limitKey) → 409
    const existing = await prisma.rateLimitRule.findFirst({
      where: { projectId, pathPattern, limitKey },
    })
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_RULE',
          message: 'A rule with this path pattern and limit key already exists for this project',
        },
      })
    }

    // Verify project exists
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) {
      return reply.status(404).send({
        success: false,
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
      })
    }

    const rule = await prisma.rateLimitRule.create({
      data: { projectId, name, pathPattern, limitKey, limitKeyHeader, limitCount, windowSecs, action, priority },
    })

    // Invalidate rules cache so the new rule is active within one TTL
    await invalidateRulesCache(redis, projectId)

    request.log.info({ projectId, ruleId: rule.id, pathPattern, limitKey }, 'rule created')

    return reply.status(201).send({
      success: true,
      data: rule as unknown as RateLimitRuleRecord,
    })
  })

  // PATCH /v1/rules/:ruleId — update rule fields; invalidates cache immediately
  app.patch<{ Params: { ruleId: string } }>('/rules/:ruleId', async (request, reply) => {
    const { ruleId } = request.params

    const parsed = updateRuleSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    const existing = await prisma.rateLimitRule.findUnique({ where: { id: ruleId } })
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Rule not found' },
      })
    }

    const updated = await prisma.rateLimitRule.update({
      where: { id: ruleId },
      data: parsed.data,
    })

    await invalidateRulesCache(redis, existing.projectId)

    request.log.info({ ruleId, projectId: existing.projectId }, 'rule updated')

    return reply.send({
      success: true,
      data: updated as unknown as RateLimitRuleRecord,
    })
  })

  // DELETE /v1/rules/:ruleId — remove a rule and invalidate cache immediately
  app.delete<{ Params: { ruleId: string } }>('/rules/:ruleId', async (request, reply) => {
    const { ruleId } = request.params

    const existing = await prisma.rateLimitRule.findUnique({ where: { id: ruleId } })
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Rule not found' },
      })
    }

    await prisma.rateLimitRule.delete({ where: { id: ruleId } })
    await invalidateRulesCache(redis, existing.projectId)

    request.log.info({ ruleId, projectId: existing.projectId }, 'rule deleted')

    return reply.status(204).send()
  })

  // PUT /v1/rules/:ruleId/toggle — flip enabled; cache invalidated immediately
  app.put<{ Params: { ruleId: string } }>('/rules/:ruleId/toggle', async (request, reply) => {
    const { ruleId } = request.params

    const existing = await prisma.rateLimitRule.findUnique({ where: { id: ruleId } })
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Rule not found' },
      })
    }

    const updated = await prisma.rateLimitRule.update({
      where: { id: ruleId },
      data: { enabled: !existing.enabled },
    })

    // Invalidate cache — new state propagates to /v1/check within one cache TTL (≤ 30s)
    await invalidateRulesCache(redis, existing.projectId)

    request.log.info(
      { ruleId, projectId: existing.projectId, enabled: updated.enabled },
      'rule toggled',
    )

    return reply.send({
      success: true,
      data: updated as unknown as RateLimitRuleRecord,
    })
  })
}
