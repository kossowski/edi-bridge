import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate as applyMigrations } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export async function migrate(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} })

  try {
    await applyMigrations(drizzle({ client: sql }), { migrationsFolder })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
