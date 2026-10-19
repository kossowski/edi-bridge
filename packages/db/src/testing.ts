import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

import { migrate, migrationsFolder } from './migrate.js'

const image = 'postgres:18.6-alpine3.24'

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })

// A copy of the migrations folder whose journal ends at `upTo`, so a later full migrate applies the rest.
async function migrationsUpTo(upTo: string) {
  const journal = journalSchema.parse(
    JSON.parse(await readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')),
  )

  const end = journal.entries.findIndex((entry) => entry.tag === upTo)

  if (end === -1) {
    throw new Error(`No migration ${upTo}`)
  }

  const entries = journal.entries.slice(0, end + 1)
  const folder = await mkdtemp(path.join(tmpdir(), 'migrations-'))

  await mkdir(path.join(folder, 'meta'))
  await writeFile(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )
  await Promise.all(
    entries.map(({ tag }) =>
      copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(folder, `${tag}.sql`)),
    ),
  )

  return folder
}

export async function startTestDatabase({ upTo }: { upTo?: string } = {}) {
  const container = await new PostgreSqlContainer(image).start()
  const url = container.getConnectionUri()

  if (upTo === undefined) {
    await migrate(url)
  } else {
    const folder = await migrationsUpTo(upTo)

    await migrate(url, folder)
    await rm(folder, { recursive: true })
  }

  return {
    url,
    stop: async () => {
      await container.stop()
    },
  }
}

export type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>
