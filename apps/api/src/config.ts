import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.url().default('postgres://edi_bridge:edi_bridge@localhost:5432/edi_bridge'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
})

const env = envSchema.safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

/** Runtime configuration from the environment, with defaults matching the local Compose services. */
export const config = {
  databaseUrl: env.data.DATABASE_URL,
  redisUrl: env.data.REDIS_URL,
  port: env.data.API_PORT,
}
