import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  DRIFT_COLLECTOR_PORT: z.string().default('3003'),
  DRIFT_INTERNAL_TOKEN: z.string().min(32),
  DRIFT_MAX_KEYS_PER_SNAPSHOT: z.string().default('500'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('alerts@pulseobserve.com'),
})

export const env = envSchema.parse(process.env)

export const redisUrl = env.REDIS_URL

export const maxKeysPerSnapshot = parseInt(env.DRIFT_MAX_KEYS_PER_SNAPSHOT, 10)
