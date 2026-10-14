import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.js'

export function connect(url: string) {
  const sql = postgres(url, { max: 5 })
  const db = drizzle({ client: sql, schema, casing: 'snake_case' })

  return {
    db,
    close: () => sql.end({ timeout: 5 }),
  }
}

export type Database = ReturnType<typeof connect>
