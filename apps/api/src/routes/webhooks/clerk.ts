import type { FastifyInstance } from 'fastify'
import { Webhook } from 'svix'
import pino from 'pino'
import { prisma } from '@runic/db'
import { env } from '../../env'

const logger = pino({ name: 'clerk-webhook' })

interface ClerkEmailAddress {
  id: string
  email_address: string
}

interface ClerkUserCreatedData {
  id: string
  email_addresses: ClerkEmailAddress[]
  primary_email_address_id: string
}

interface ClerkWebhookEvent {
  type: string
  data: ClerkUserCreatedData
}

export async function clerkWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/clerk',
    { config: { rateLimit: false, rawBody: true } },
    async (request, reply) => {
      const svixId = request.headers['svix-id']
      const svixTimestamp = request.headers['svix-timestamp']
      const svixSignature = request.headers['svix-signature']

      if (
        typeof svixId !== 'string' ||
        typeof svixTimestamp !== 'string' ||
        typeof svixSignature !== 'string'
      ) {
        return reply.status(400).send({ error: 'Missing svix signature headers' })
      }

      const wh = new Webhook(env.CLERK_WEBHOOK_SECRET)
      let event: ClerkWebhookEvent

      try {
        const rawBody = (request as unknown as { rawBody: Buffer }).rawBody
        event = wh.verify(rawBody, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        }) as ClerkWebhookEvent
      } catch (err) {
        logger.warn({ err }, 'Clerk webhook signature verification failed')
        return reply.status(400).send({ error: 'Invalid webhook signature' })
      }

      if (event.type === 'user.created') {
        const primary = event.data.email_addresses.find(
          (e) => e.id === event.data.primary_email_address_id,
        )
        const email = primary?.email_address ?? event.data.email_addresses[0]?.email_address ?? ''

        await prisma.user.upsert({
          where: { clerkId: event.data.id },
          update: { email },
          create: { clerkId: event.data.id, email },
        })

        logger.info({ clerkId: event.data.id }, 'User upserted from Clerk webhook')
      }

      return reply.send({ success: true })
    },
  )
}
