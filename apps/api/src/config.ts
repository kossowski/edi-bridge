import { z } from 'zod'

import { localDatabaseUrl } from '@edi-bridge/db'

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
  })

export function loadConfig(source: NodeJS.ProcessEnv) {
  const env = envSchema(source.NODE_ENV === 'production').safeParse(source)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  const webOrigin = env.data.WEB_ORIGIN

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
  }
}

export const config = loadConfig(process.env)
