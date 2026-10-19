import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate as applyMigrations } from 'drizzle-orm/postgres-js/migrator'
import { createRequire } from 'node:module'
import path from 'node:path'
import postgres from 'postgres'

// Resolved through the package, so it still works when the api bundles this file.
export const migrationsFolder = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@edi-bridge/db/package.json')),
  'migrations',
)

export async function migrate(url: string, folder = migrationsFolder) {
  const sql = postgres(url, { max: 1, onnotice: () => {} })

  try {
    await applyMigrations(drizzle({ client: sql }), { migrationsFolder: folder })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
