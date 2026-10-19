import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Connection } from './client.js'
import { claimControlReference } from './control-reference.js'
import { runs } from './schema.js'
import { newRun, only } from './test-fixtures.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

let testDatabase: TestDatabase

let connection: Connection

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const insertRun = (run: typeof runs.$inferInsert) =>
  only(
    connection.db
      .insert(runs)
      .values(run)
      .returning({ workspaceId: runs.workspaceId, runId: runs.id }),
  )

describe('claiming an Interchange control reference', () => {
  it('starts at 1 for a new Trading Partner', async () => {
    const run = await insertRun((await newRun(connection.db)).run)

    await expect(claimControlReference(connection.db, run)).resolves.toBe(1)
  })

  it('never hands two Runs of one Trading Partner the same reference', async () => {
    const { run } = await newRun(connection.db)

    const claimed = await Promise.all(
      Array.from({ length: 20 }, async () =>
        claimControlReference(connection.db, await insertRun(run)),
      ),
    )

    expect(claimed.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('gives a Run the reference it already holds', async () => {
    const run = await insertRun((await newRun(connection.db)).run)

    const claimed = await Promise.all([
      claimControlReference(connection.db, run),
      claimControlReference(connection.db, run),
    ])

    await expect(claimControlReference(connection.db, run)).resolves.toBe(1)
    expect(claimed).toEqual([1, 1])
  })

  it('counts separately for each Trading Partner', async () => {
    const first = await insertRun((await newRun(connection.db)).run)
    const second = await insertRun((await newRun(connection.db)).run)

    await claimControlReference(connection.db, first)

    await expect(claimControlReference(connection.db, second)).resolves.toBe(1)
  })

  it('claims nothing for a Run of another Workspace', async () => {
    const run = await insertRun((await newRun(connection.db)).run)
    const other = await insertRun((await newRun(connection.db)).run)

    await expect(
      claimControlReference(connection.db, { workspaceId: other.workspaceId, runId: run.runId }),
    ).rejects.toThrow()
  })
})
