import { z } from 'zod'

import { localDatabaseUrl } from '@edi-bridge/db'

const envSchema = z.object({
  DATABASE_URL: z.url().default(localDatabaseUrl),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
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
}
