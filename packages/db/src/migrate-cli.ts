import { z } from 'zod'

import { migrate } from './migrate.js'

const env = z
  .object({
    DATABASE_URL: z.url().default('postgres://edi_bridge:edi_bridge@localhost:5432/edi_bridge'),
  })
  .safeParse(process.env)

if (!env.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(env.error)}`)
}

await migrate(env.data.DATABASE_URL)
