import { z } from 'zod'

import { localDatabaseUrl } from './client.js'
import { migrate } from './migrate.js'

const env = z
  .object({
    DATABASE_URL: z.url().default(localDatabaseUrl),
  })
  .safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

await migrate(env.data.DATABASE_URL)
