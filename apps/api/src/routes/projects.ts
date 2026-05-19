import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '../lib/api-key'
import { verifyClerkJwt } from '../lib/auth'

const createProjectBodySchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post('/projects', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found. Please sign in again.' },
      })
    }

    const parsed = createProjectBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyPrefix = getApiKeyPrefix(rawApiKey)

    const project = await prisma.project.create({
      data: {
        name: parsed.data.name,
        apiKeyHash,
        apiKeyPrefix,
        userId: user.id,
      },
    })

    return reply.status(201).send({
      success: true,
      data: {
        projectId: project.id,
        name: project.name,
        apiKey: rawApiKey,
        apiKeyPrefix: project.apiKeyPrefix,
      },
    })
  })

  // DEV CONVENIENCE — regenerates and reveals the API key. Remove before production.
  app.post('/projects/:projectId/reveal-key', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found. Please sign in again.' },
      })
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
    })
    if (!project) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      })
    }

    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyPrefix = getApiKeyPrefix(rawApiKey)

    await prisma.project.update({
      where: { id: projectId },
      data: { apiKeyHash, apiKeyPrefix },
    })

    return reply.status(200).send({
      success: true,
      data: { projectId, apiKey: rawApiKey, apiKeyPrefix },
    })
  })
}
