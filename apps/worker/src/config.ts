import { Duration } from 'effect'
import { z } from 'zod'

import { localDatabaseUrl } from '@edi-bridge/db'

const envSchema = z.object({
  DATABASE_URL: z.url().default(localDatabaseUrl),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
  RUN_REQUEUE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
})

const env = envSchema.safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

export const config = {
  databaseUrl: env.data.DATABASE_URL,
  redisUrl: env.data.REDIS_URL,
  healthPort: env.data.WORKER_HEALTH_PORT,
  requeueInterval: Duration.seconds(env.data.RUN_REQUEUE_INTERVAL_SECONDS),
}
