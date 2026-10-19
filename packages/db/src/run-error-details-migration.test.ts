import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runErrorSchema, runProblemSchema } from '@edi-bridge/contracts'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import { runs } from './schema.js'
import { newRun, only } from './test-fixtures.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

const storedProblemSchema = runProblemSchema.omit({ whoFixes: true })

const channelId = '00000000-0000-4000-8000-000000000001'

const failedRuns = [
  {
    name: 'an unreadable Document',
    failureStage: 'parse',
    error: { code: 'unparseable', message: 'The Document is not valid JSON', position: null },
    problem: { reason: 'unreadable', fixTarget: null },
    migratedReason: 'unreadable',
  },
  {
    name: 'invalid content',
    failureStage: 'validation',
    error: {
      code: 'invalidValue',
      message: 'DTM 2380 is not a date',
      position: { segment: 3, tag: 'DTM', element: 1, component: 2 },
    },
    problem: { reason: 'invalidContent', fixTarget: null },
    migratedReason: 'invalidContent',
  },
  {
    name: 'a missing code',
    failureStage: 'mapping',
    error: { code: 'noLookupMatch', message: 'No Lookup Table entry for ST', position: null },
    problem: { reason: 'missingCode', fixTarget: null },
    migratedReason: 'missingCode',
  },
  {
    name: 'a missing field',
    failureStage: 'validation',
    error: {
      code: 'missingField',
      message: 'BGM 1004 document number is missing',
      position: { segment: 2, tag: 'BGM', element: 2, component: null },
    },
    problem: { reason: 'missingField', fixTarget: null },
    migratedReason: 'missingField',
  },
  {
    name: 'an unreachable destination',
    failureStage: 'delivery',
    error: { code: 'deliveryFailed', message: 'The destination answered 503', position: null },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'unreachable',
  },
  {
    name: 'an incomplete setup',
    failureStage: 'delivery',
    error: { code: 'channelDefect', message: 'The SFTP key is missing', position: null },
    problem: {
      reason: 'incompleteSetup',
      fixTarget: { kind: 'channelCredential', channelId, name: 'Hanse Retail SFTP' },
    },
    migratedReason: 'incompleteSetup',
  },
  {
    name: 'a processing defect before delivery',
    failureStage: 'mapping',
    error: {
      code: 'processingDefect',
      message: 'The processing stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'invalidContent', fixTarget: null },
    migratedReason: 'defect',
  },
  {
    name: 'a processing defect at delivery',
    failureStage: 'delivery',
    error: {
      code: 'processingDefect',
      message: 'The processing stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'defect',
  },
  {
    name: 'a delivery defect',
    failureStage: 'delivery',
    error: {
      code: 'deliveryDefect',
      message: 'The delivery stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'defect',
  },
] as const

type StoredFailure = (typeof failedRuns)[number]['error' | 'problem']

const jsonb = (value: StoredFailure) => sql`${JSON.stringify(value)}::jsonb`

let testDatabase: TestDatabase

let connection: Connection

const runIds = new Map<string, string>()

let deliveredRunId: string

beforeAll(async () => {
  testDatabase = await startTestDatabase({ upTo: '0015_run_message_index' })
  connection = connect(testDatabase.url)

  for (const failed of failedRuns) {
    const { run } = await newRun(connection.db)

    const stored = await only(
      connection.db
        .insert(runs)
        .values({
          ...run,
          status: 'failed',
          failureStage: failed.failureStage,
          error: jsonb(failed.error),
          problem: jsonb(failed.problem),
        })
        .returning({ id: runs.id }),
    )

    runIds.set(failed.name, stored.id)
  }

  const { run } = await newRun(connection.db)

  deliveredRunId = (
    await only(
      connection.db
        .insert(runs)
        .values({ ...run, status: 'delivered' })
        .returning({ id: runs.id }),
    )
  ).id

  await migrate(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const storedRun = (id: string) => only(connection.db.select().from(runs).where(eq(runs.id, id)))

describe('migration 0016 on a failed Run stored before error details', () => {
  it.each(failedRuns)(
    'gives the error of $name no details and the problem reason $migratedReason',
    async (failed) => {
      const run = await storedRun(runIds.get(failed.name) ?? '')

      expect(runErrorSchema.parse(run.error)).toEqual({ ...failed.error, details: null })
      expect(storedProblemSchema.parse(run.problem)).toEqual({
        ...failed.problem,
        reason: failed.migratedReason,
      })
    },
  )

  it('leaves a Run that did not fail without error and problem', async () => {
    const run = await storedRun(deliveredRunId)

    expect(run).toMatchObject({ status: 'delivered', error: null, problem: null })
  })
})
