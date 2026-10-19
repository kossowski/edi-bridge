import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.js'

export const localDatabaseUrl = 'postgres://edi_bridge:edi_bridge@localhost:5432/edi_bridge'

export function connect(url: string) {
  const sql = postgres(url, { max: 5 })
  const db = drizzle({ client: sql, schema, casing: 'snake_case' })

  return {
    db,
    close: () => sql.end({ timeout: 5 }),
  }
}

export type Connection = ReturnType<typeof connect>

export type Transaction = Parameters<Parameters<Connection['db']['transaction']>[0]>[0]
