import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { redis } from '../lib/redis'

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis,
  })
}
