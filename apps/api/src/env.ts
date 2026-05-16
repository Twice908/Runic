import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  API_KEY_SECRET: z.string().min(32),
})

export const env = envSchema.parse(process.env)
