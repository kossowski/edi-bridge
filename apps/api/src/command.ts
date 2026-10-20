import { z } from 'zod'

import { type SecretBox, secretBox, secretKeyEnv } from '@edi-bridge/channels'
import { connect, localDatabaseUrl, migrate } from '@edi-bridge/db'

import type { Database } from './db.js'

const baseEnv = z.object({
  DATABASE_URL: z.url().default(localDatabaseUrl),
  CHANNEL_SECRET_KEY: secretKeyEnv(process.env.NODE_ENV === 'production'),
})

const parsed = <T>(schema: z.ZodType<T>) => {
  const env = schema.safeParse(process.env)

  if (!env.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
  }

  return env.data
}

export async function runSeedCommand<Extra>(
  failure: string,
  extraEnv: z.ZodType<Extra>,
  command: (db: Database, secrets: SecretBox, env: Extra) => Promise<void>,
) {
  try {
    const { DATABASE_URL: databaseUrl, CHANNEL_SECRET_KEY: secretKey } = parsed(baseEnv)
    const extra = parsed(extraEnv)

    await migrate(databaseUrl)

    const connection = connect(databaseUrl)

    try {
      await command(connection.db, secretBox(secretKey), extra)
    } finally {
      await connection.close()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : failure)
    process.exitCode = 1
  }
}
