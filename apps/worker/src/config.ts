import { Duration } from 'effect'
import { z } from 'zod'

import { secretKeyEnv } from '@edi-bridge/channels'
import { localDatabaseUrl } from '@edi-bridge/db'

const envSchema = (production: boolean) =>
  z.object({
    DATABASE_URL: z.url().default(localDatabaseUrl),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
    RUN_REQUEUE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    RUN_STUCK_AFTER_MINUTES: z.coerce.number().int().positive().default(10),
    CHANNEL_SECRET_KEY: secretKeyEnv(production),
  })

export function loadConfig(source: NodeJS.ProcessEnv) {
  const env = envSchema(source.NODE_ENV === 'production').safeParse(source)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  return {
    databaseUrl: env.data.DATABASE_URL,
    redisUrl: env.data.REDIS_URL,
    healthPort: env.data.WORKER_HEALTH_PORT,
    requeueInterval: Duration.seconds(env.data.RUN_REQUEUE_INTERVAL_SECONDS),
    stuckAfter: Duration.minutes(env.data.RUN_STUCK_AFTER_MINUTES),
    channelSecretKey: env.data.CHANNEL_SECRET_KEY,
  }
}

export const config = loadConfig(process.env)
