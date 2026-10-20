import { Duration } from 'effect'
import { z } from 'zod'

import { secretKeyEnv } from '@edi-bridge/channels'
import { localDatabaseUrl } from '@edi-bridge/db'

import type { SentryConfig } from './sentry.js'

const envSchema = (production: boolean) =>
  z.object({
    DATABASE_URL: z.url().default(localDatabaseUrl),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
    // Also paces the sweep of stuck Runs, the Overdue check and the sending of CONTRLs.
    RUN_REQUEUE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    RUN_STUCK_AFTER_MINUTES: z.coerce.number().int().positive().default(10),
    CHANNEL_SECRET_KEY: secretKeyEnv(production),
    SENTRY_DSN: z.union([z.literal(''), z.url()]).optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().min(0).max(1).default(0.1),
    ),
  })

export function loadConfig(source: NodeJS.ProcessEnv) {
  const env = envSchema(source.NODE_ENV === 'production').safeParse(source)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  const sentry: SentryConfig | undefined = env.data.SENTRY_DSN
    ? {
        dsn: env.data.SENTRY_DSN,
        environment: env.data.SENTRY_ENVIRONMENT || undefined,
        tracesSampleRate: env.data.SENTRY_TRACES_SAMPLE_RATE,
      }
    : undefined

  return {
    databaseUrl: env.data.DATABASE_URL,
    redisUrl: env.data.REDIS_URL,
    healthPort: env.data.WORKER_HEALTH_PORT,
    requeueInterval: Duration.seconds(env.data.RUN_REQUEUE_INTERVAL_SECONDS),
    stuckAfter: Duration.minutes(env.data.RUN_STUCK_AFTER_MINUTES),
    channelSecretKey: env.data.CHANNEL_SECRET_KEY,
    sentry,
  }
}

export const config = loadConfig(process.env)
