import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { documentRetentionDays } from '@edi-bridge/contracts'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import {
  documents,
  documentStructures,
  lookupTableEntries,
  lookupTables,
  runs,
  runSteps,
  tradingPartners,
  workspaces,
} from './schema.js'
import { insertWorkspace, newRun, only, tradingPartner } from './test-fixtures.js'
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

describe('migrate', () => {
  it('applies again without changes to an up-to-date database', async () => {
    await expect(migrate(testDatabase.url)).resolves.toBeUndefined()
  })
})

describe('schema', () => {
  it('stores a Trading Partner in Test Mode with empty onboarding', async () => {
    const workspace = await insertWorkspace(connection.db)

    const [stored] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, workspaceId: workspace.id })
      .returning()

    expect(stored).toMatchObject({
      ...tradingPartner,
      workspaceId: workspace.id,
      testMode: true,
      testInterchangeSentAt: null,
      contrlReceivedAt: null,
    })
  })

  it('returns an onboarding timestamp as the same instant', async () => {
    const workspace = await insertWorkspace(connection.db)
    const sentAt = new Date('2026-10-14T12:00:00.123Z')

    const [stored] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, workspaceId: workspace.id, testInterchangeSentAt: sentAt })
      .returning()

    expect(stored?.testInterchangeSentAt).toEqual(sentAt)
  })

  it('rejects a Trading Partner without an existing Workspace', async () => {
    await expect(
      connection.db
        .insert(tradingPartners)
        .values({ ...tradingPartner, workspaceId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow()
  })
})

describe('a Workspace', () => {
  it('has the default retention period', async () => {
    const workspace = await insertWorkspace(connection.db)

    expect(workspace.documentRetentionDays).toBe(documentRetentionDays.default)
  })

  it.each([documentRetentionDays.min, documentRetentionDays.max])(
    'stores a retention period of %i days',
    async (days) => {
      const workspace = await insertWorkspace(connection.db)

      const stored = await only(
        connection.db
          .update(workspaces)
          .set({ documentRetentionDays: days })
          .where(eq(workspaces.id, workspace.id))
          .returning(),
      )

      expect(stored.documentRetentionDays).toBe(days)
    },
  )

  it.each([documentRetentionDays.min - 1, documentRetentionDays.max + 1])(
    'rejects a retention period of %i days',
    async (days) => {
      const workspace = await insertWorkspace(connection.db)

      await expect(
        connection.db
          .update(workspaces)
          .set({ documentRetentionDays: days })
          .where(eq(workspaces.id, workspace.id)),
      ).rejects.toMatchObject({
        cause: { constraint_name: 'document_retention_days_range' },
      })
    },
  )
})

describe('a Lookup Table', () => {
  async function insertLookupTable(workspaceId: string, tradingPartnerId: string | null = null) {
    const [lookupTable] = await connection.db
      .insert(lookupTables)
      .values({ workspaceId, tradingPartnerId, name: 'Units', kind: 'units' })
      .returning()

    if (lookupTable === undefined) {
      throw new Error('Lookup Table insert returned no row')
    }

    await connection.db
      .insert(lookupTableEntries)
      .values({ lookupTableId: lookupTable.id, position: 0, sourceCode: 'ST', targetCode: 'PCE' })

    return lookupTable
  }

  const entriesOf = (lookupTableId: string) =>
    connection.db
      .select()
      .from(lookupTableEntries)
      .where(eq(lookupTableEntries.lookupTableId, lookupTableId))

  it('takes its entries along when deleted', async () => {
    const workspace = await insertWorkspace(connection.db)
    const lookupTable = await insertLookupTable(workspace.id)

    await connection.db.delete(lookupTables).where(eq(lookupTables.id, lookupTable.id))

    await expect(entriesOf(lookupTable.id)).resolves.toEqual([])
  })

  it('is deleted with the Trading Partner it belongs to', async () => {
    const workspace = await insertWorkspace(connection.db)

    const [partner] = await connection.db
      .insert(tradingPartners)
      .values({ ...tradingPartner, gln: null, workspaceId: workspace.id })
      .returning({ id: tradingPartners.id })

    if (partner === undefined) {
      throw new Error('Trading Partner insert returned no row')
    }

    const lookupTable = await insertLookupTable(workspace.id, partner.id)

    await connection.db.delete(tradingPartners).where(eq(tradingPartners.id, partner.id))

    await expect(
      connection.db.select().from(lookupTables).where(eq(lookupTables.id, lookupTable.id)),
    ).resolves.toEqual([])
    await expect(entriesOf(lookupTable.id)).resolves.toEqual([])
  })
})

describe('a Document Structure', () => {
  const ordersStructure = {
    name: 'ERP orders',
    format: 'json',
    jsonRoot: 'object',
    children: [
      {
        kind: 'field',
        path: 'orderNumber',
        name: 'orderNumber',
        label: 'Order number',
        labelReason: null,
        labelUnsure: false,
        required: true,
        type: 'string',
      },
    ],
  } satisfies Omit<typeof documentStructures.$inferInsert, 'workspaceId'>

  it('is deleted with its Workspace', async () => {
    const workspace = await insertWorkspace(connection.db)

    await connection.db
      .insert(documentStructures)
      .values({ ...ordersStructure, workspaceId: workspace.id })

    await connection.db.delete(workspaces).where(eq(workspaces.id, workspace.id))

    await expect(
      connection.db
        .select()
        .from(documentStructures)
        .where(eq(documentStructures.workspaceId, workspace.id)),
    ).resolves.toEqual([])
  })

  it('rejects CSV settings on a JSON Document Structure', async () => {
    const workspace = await insertWorkspace(connection.db)

    await expect(
      connection.db.insert(documentStructures).values({
        ...ordersStructure,
        workspaceId: workspace.id,
        csv: { delimiter: ';', headerRow: true, encoding: 'utf-8' },
      }),
    ).rejects.toThrow()
  })

  it('rejects a sample without its text', async () => {
    const workspace = await insertWorkspace(connection.db)

    await expect(
      connection.db.insert(documentStructures).values({
        ...ordersStructure,
        workspaceId: workspace.id,
        sampleFileName: 'order.json',
        sampleTakenAt: new Date('2026-10-14T12:00:00.000Z'),
      }),
    ).rejects.toThrow()
  })
})

describe('a Run', () => {
  it('records a received Run of a Manual Submission', async () => {
    const { run } = await newRun(connection.db)

    const stored = await only(connection.db.insert(runs).values(run).returning())

    expect(stored).toMatchObject({
      ...run,
      status: 'received',
      failureStage: null,
      mappingVersionId: null,
      businessReference: null,
      error: null,
      output: null,
      messageIndex: null,
    })
  })

  it('records the position of its Message in the Interchange', async () => {
    const { run } = await newRun(connection.db)

    const stored = await only(
      connection.db
        .insert(runs)
        .values({ ...run, messageIndex: 2 })
        .returning(),
    )

    expect(stored.messageIndex).toBe(2)
  })

  it('rejects a Message index below one', async () => {
    const { run } = await newRun(connection.db)

    await expect(connection.db.insert(runs).values({ ...run, messageIndex: 0 })).rejects.toThrow()
  })

  const validationError = {
    code: 'missingField',
    message: 'BGM 1004 document number is missing',
    position: { segment: 2, tag: 'BGM', element: 2, component: null },
    details: null,
  }

  const failedValidation = {
    status: 'failed',
    failureStage: 'validation',
    error: validationError,
    problem: { reason: 'missingField', fixTarget: null },
  } satisfies Partial<typeof runs.$inferInsert>

  it('records a Run that failed validation with its error and no output', async () => {
    const { run } = await newRun(connection.db)

    const stored = await only(
      connection.db
        .insert(runs)
        .values({ ...run, ...failedValidation })
        .returning(),
    )

    expect(stored).toMatchObject({ ...failedValidation, output: null })
  })

  it('rejects a failed Run without its Failure Stage', async () => {
    const { run } = await newRun(connection.db)

    await expect(
      connection.db.insert(runs).values({ ...run, ...failedValidation, failureStage: null }),
    ).rejects.toThrow()
  })

  it('rejects a failed Run without its error', async () => {
    const { run } = await newRun(connection.db)

    await expect(
      connection.db.insert(runs).values({ ...run, ...failedValidation, error: null }),
    ).rejects.toThrow()
  })

  it('rejects a Failure Stage on a Run that did not fail', async () => {
    const { run } = await newRun(connection.db)

    await expect(
      connection.db.insert(runs).values({ ...run, status: 'processing', failureStage: 'mapping' }),
    ).rejects.toThrow()
  })

  it('never stores output for a Run that failed validation', async () => {
    const { run } = await newRun(connection.db)

    await expect(
      connection.db
        .insert(runs)
        .values({ ...run, ...failedValidation, output: "UNH+1+INVOIC:D:96A:UN:EAN008'" }),
    ).rejects.toThrow()
  })

  it('rejects waiting for the Trading Partner on a Run that did not fail', async () => {
    const { run } = await newRun(connection.db)

    await expect(
      connection.db
        .insert(runs)
        .values({ ...run, waitingForTradingPartnerSince: new Date('2026-10-14T12:00:00.000Z') }),
    ).rejects.toThrow()
  })

  describe('steps', () => {
    const at = (time: string) => new Date(`2026-10-14T${time}Z`)

    async function insertRun() {
      const { run, mappingVersion } = await newRun(connection.db)

      return only(
        connection.db
          .insert(runs)
          .values({
            ...run,
            status: 'processing',
            mappingVersionId: mappingVersion.id,
            businessReference: 'INV-1001',
            output: "UNH+1+INVOIC:D:96A:UN:EAN008'",
          })
          .returning(),
      )
    }

    const stepsOf = (runId: string) =>
      connection.db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(runSteps.position)

    it('come back in the order they ran, with their timings', async () => {
      const run = await insertRun()

      await connection.db.insert(runSteps).values([
        { runId: run.id, position: 3, stage: 'delivery', status: 'pending' },
        {
          runId: run.id,
          position: 2,
          stage: 'validation',
          status: 'succeeded',
          startedAt: at('12:00:00.300'),
          finishedAt: at('12:00:00.420'),
        },
        {
          runId: run.id,
          position: 0,
          stage: 'receipt',
          status: 'succeeded',
          startedAt: at('12:00:00.000'),
          finishedAt: at('12:00:00.015'),
        },
        {
          runId: run.id,
          position: 1,
          stage: 'mapping',
          status: 'succeeded',
          startedAt: at('12:00:00.100'),
          finishedAt: at('12:00:00.250'),
        },
      ])

      await expect(stepsOf(run.id)).resolves.toEqual([
        {
          runId: run.id,
          position: 0,
          stage: 'receipt',
          status: 'succeeded',
          startedAt: at('12:00:00.000'),
          finishedAt: at('12:00:00.015'),
        },
        {
          runId: run.id,
          position: 1,
          stage: 'mapping',
          status: 'succeeded',
          startedAt: at('12:00:00.100'),
          finishedAt: at('12:00:00.250'),
        },
        {
          runId: run.id,
          position: 2,
          stage: 'validation',
          status: 'succeeded',
          startedAt: at('12:00:00.300'),
          finishedAt: at('12:00:00.420'),
        },
        {
          runId: run.id,
          position: 3,
          stage: 'delivery',
          status: 'pending',
          startedAt: null,
          finishedAt: null,
        },
      ])
    })

    it('rejects a finished step without its timings', async () => {
      const run = await insertRun()

      await expect(
        connection.db.insert(runSteps).values({
          runId: run.id,
          position: 1,
          stage: 'mapping',
          status: 'succeeded',
          startedAt: at('12:00:00'),
        }),
      ).rejects.toThrow()
    })

    it('rejects a pending step with a start time', async () => {
      const run = await insertRun()

      await expect(
        connection.db.insert(runSteps).values({
          runId: run.id,
          position: 3,
          stage: 'delivery',
          status: 'pending',
          startedAt: at('12:00:00'),
        }),
      ).rejects.toThrow()
    })

    it('rejects a skipped step with a finish time', async () => {
      const run = await insertRun()

      await expect(
        connection.db.insert(runSteps).values({
          runId: run.id,
          position: 3,
          stage: 'delivery',
          status: 'skipped',
          finishedAt: at('12:00:00'),
        }),
      ).rejects.toThrow()
    })

    it('rejects a step that finishes before it starts', async () => {
      const run = await insertRun()

      await expect(
        connection.db.insert(runSteps).values({
          runId: run.id,
          position: 1,
          stage: 'mapping',
          status: 'failed',
          startedAt: at('12:00:01'),
          finishedAt: at('12:00:00'),
        }),
      ).rejects.toThrow()
    })

    it('are deleted with the Workspace, together with the Run and its Document', async () => {
      const run = await insertRun()
      const { documentId } = run

      if (documentId === null) {
        throw new Error('The Run was inserted without its Document')
      }

      await connection.db.insert(runSteps).values({
        runId: run.id,
        position: 0,
        stage: 'receipt',
        status: 'running',
        startedAt: at('12:00:00'),
      })

      await connection.db.delete(workspaces).where(eq(workspaces.id, run.workspaceId))

      await expect(stepsOf(run.id)).resolves.toEqual([])
      await expect(
        connection.db.select().from(documents).where(eq(documents.id, documentId)),
      ).resolves.toEqual([])
    })
  })
})
