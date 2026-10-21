import { z } from 'zod'

import { allowedHostsEnv, secretKeyEnv } from '@edi-bridge/channels'
import { localDatabaseUrl } from '@edi-bridge/db'

import { aiModelFromEnv } from './ai-model.js'

import type { ChannelSettings } from './channel.js'
import type { SentryConfig } from './sentry.js'

const channelReachTimeoutMs = 10_000

const defaultTracesSampleRate = 0.1

// An empty value in an env file leaves the variable unset.
const unsetWhenEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const envSchema = (production: boolean) =>
  z.object({
    DATABASE_URL: z.url().default(localDatabaseUrl),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    API_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
    WEB_ORIGIN: production ? z.url().optional() : z.url().default('http://localhost:3000'),
    BETTER_AUTH_URL: production ? z.url() : z.url().default('http://localhost:3001'),
    BETTER_AUTH_SECRET: production
      ? z.string().min(32)
      : z.string().min(32).default('edi-bridge-development-secret-not-for-production'),
    CHANNEL_SECRET_KEY: secretKeyEnv(production),
    CHANNEL_ALLOWED_HOSTS: allowedHostsEnv,
    API_PUBLIC_URL: z.url().optional(),
    SENTRY_DSN: unsetWhenEmpty(z.url()),
    SENTRY_ENVIRONMENT: unsetWhenEmpty(z.string()),
    SENTRY_TRACES_SAMPLE_RATE: unsetWhenEmpty(z.coerce.number().min(0).max(1)),
  })

export function loadConfig(source: NodeJS.ProcessEnv) {
  const env = envSchema(source.NODE_ENV === 'production').safeParse(source)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  const webOrigin = env.data.WEB_ORIGIN

  // Behind the reverse proxy the API answers under /api of the public origin.
  const apiPublicUrl =
    env.data.API_PUBLIC_URL ??
    (source.NODE_ENV === 'production'
      ? new URL('/api', env.data.BETTER_AUTH_URL).href
      : env.data.BETTER_AUTH_URL)

  return {
    databaseUrl: env.data.DATABASE_URL,
    redisUrl: env.data.REDIS_URL,
    port: env.data.API_PORT,
    webOrigin,
    auth: {
      secret: env.data.BETTER_AUTH_SECRET,
      baseUrl: env.data.BETTER_AUTH_URL,
      trustedOrigins: webOrigin === undefined ? [] : [webOrigin],
    },
    channels: {
      secretKey: env.data.CHANNEL_SECRET_KEY,
      apiPublicUrl,
      reachTimeoutMs: channelReachTimeoutMs,
      allowedHosts: env.data.CHANNEL_ALLOWED_HOSTS,
    } satisfies ChannelSettings,
    aiModel: aiModelFromEnv(source),
    sentry:
      env.data.SENTRY_DSN === undefined
        ? null
        : ({
            dsn: env.data.SENTRY_DSN,
            environment: env.data.SENTRY_ENVIRONMENT,
            tracesSampleRate: env.data.SENTRY_TRACES_SAMPLE_RATE ?? defaultTracesSampleRate,
          } satisfies SentryConfig),
  }
}

export const config = loadConfig(process.env)
