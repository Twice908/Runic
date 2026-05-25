import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Inherited shared vars
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  // Rate Limiter specific
  RATE_LIMITER_PORT: z.string().default('3002'),
  RATE_LIMITER_INTERNAL_TOKEN: z.string().min(32),
  RATE_LIMITER_REDIS_URL: z.string().optional(),
  RATE_LIMITER_RULE_CACHE_TTL: z.string().default('30'),
  RATE_LIMITER_CHECK_TIMEOUT_MS: z.string().default('1000'),
})

export const env = envSchema.parse(process.env)

export const redisUrl = env.RATE_LIMITER_REDIS_URL ?? env.REDIS_URL

export const ruleCacheTtl = parseInt(env.RATE_LIMITER_RULE_CACHE_TTL, 10)

export const checkTimeoutMs = parseInt(env.RATE_LIMITER_CHECK_TIMEOUT_MS, 10)
