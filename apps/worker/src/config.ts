import { z } from 'zod'

const envSchema = z.object({
  REDIS_URL: z.url().default('redis://localhost:6379'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
})

const env = envSchema.safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

export const config = {
  redisUrl: env.data.REDIS_URL,
  healthPort: env.data.WORKER_HEALTH_PORT,
}
