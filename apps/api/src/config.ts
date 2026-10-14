import { z } from 'zod'

import { localDatabaseUrl } from '@edi-bridge/db'

const production = process.env.NODE_ENV === 'production'

const envSchema = z.object({
  DATABASE_URL: z.url().default(localDatabaseUrl),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  BETTER_AUTH_URL: production ? z.url() : z.url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: production
    ? z.string().min(32)
    : z.string().min(32).default('edi-bridge-development-secret-not-for-production'),
})

const env = envSchema.safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

export const config = {
  databaseUrl: env.data.DATABASE_URL,
  redisUrl: env.data.REDIS_URL,
  port: env.data.API_PORT,
  webOrigin: env.data.WEB_ORIGIN,
  auth: {
    secret: env.data.BETTER_AUTH_SECRET,
    baseUrl: env.data.BETTER_AUTH_URL,
    trustedOrigins: [env.data.WEB_ORIGIN],
  },
}
