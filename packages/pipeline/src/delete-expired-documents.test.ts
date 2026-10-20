import { eq, sql } from 'drizzle-orm'
import { Duration, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  acknowledgements,
  connect,
  type Connection,
  documents,
  runs,
  workspaces,
} from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { deleteExpiredDocumentsInBatchesOf } from './delete-expired-documents'
import {
  deleteExpiredDocuments,
  isReprocessable,
  processRun,
  receive,
  reprocessRun,
  RunNotReprocessable,
  sweepRunsEvery,
} from './index'
import {
  goldenInvoice,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  markSeeded,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
} from './testing'

let testDatabase: TestDatabase

let connection: Connection

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
}, 120_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const receiveInvoice = async (into: InvoiceWorkspace) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: into.id,
      channelId: into.inboundChannelId,
      fileName: 'invoice.json',
      content: goldenInvoice,
      manualSubmission: true,
    }).pipe(pipelineServices(connection.db, inMemoryRunQueue())),
  )

  const run = await readRun(connection.db, receipt.runs[0]?.id ?? '')

  if (run === undefined || run.document === undefined) {
    throw new Error('The invoice was not received')
  }

  return { ...run, document: run.document }
}

const failAtMapping = async (into: InvoiceWorkspace, runId: string) => {
  await connection.db
    .update(runs)
    .set({
      status: 'failed',
      failureStage: 'mapping',
      mappingVersionId: into.mappingVersionId,
      error: {
        code: 'processingDefect',
        message: 'The processing stopped on an unexpected error',
        position: null,
        details: null,
      },
      problem: { reason: 'defect', fixTarget: null },
    })
    .where(eq(runs.id, runId))
}

const receiveFailedInvoice = async (into: InvoiceWorkspace) => {
  const received = await receiveInvoice(into)

  await failAtMapping(into, received.id)

  return { ...received, status: 'failed' as const }
}

const reprocess = (into: InvoiceWorkspace, runId: string) =>
  Effect.runPromise(
    reprocessRun({ workspaceId: into.id, runId, mappingVersionId: into.mappingVersionId }).pipe(
      pipelineServices(connection.db, inMemoryRunQueue()),
    ),
  )

const refusedReprocess = (into: InvoiceWorkspace, runId: string) =>
  Effect.runPromise(
    reprocessRun({ workspaceId: into.id, runId, mappingVersionId: into.mappingVersionId }).pipe(
      Effect.flip,
      pipelineServices(connection.db, inMemoryRunQueue()),
    ),
  )

const at = <A, E>(time: Date, effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(time.getTime())

      return yield* effect
    }).pipe(Effect.provide(TestClock.layer())),
  )

const deleteAt = (time: Date) =>
  at(time, deleteExpiredDocuments.pipe(pipelineServices(connection.db, inMemoryRunQueue())))

const after = (time: Date, duration: Duration.Duration) =>
  new Date(time.getTime() + Duration.toMillis(duration))

describe('the deletion of expired Documents', () => {
  it('deletes a Document once the retention period of its Workspace passed and keeps its Run', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Expired Foods')
    const received = await receiveFailedInvoice(into)
    const deletedAt = after(received.document.receivedAt, Duration.days(90))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      id: received.id,
      status: received.status,
      flowId: received.flowId,
      documentId: null,
      documentDeletedAt: deletedAt,
      document: undefined,
      steps: received.steps,
    })
  })

  it('keeps a Document received over a seeded Channel past the retention period of its Workspace', async () => {
    const seeded = await seedInvoiceWorkspace(connection.db, 'Seeded Expired Foods')
    const into = await seedInvoiceWorkspace(connection.db, 'Unseeded Expired Foods')

    await markSeeded(connection.db, seeded.inboundChannelId)

    const kept = await receiveFailedInvoice(seeded)
    const expired = await receiveFailedInvoice(into)
    const deletedAt = after(expired.document.receivedAt, Duration.days(90))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, kept.id)).resolves.toMatchObject({
      documentId: kept.document.id,
      documentDeletedAt: null,
      document: { content: goldenInvoice },
    })
    await expect(readRun(connection.db, expired.id)).resolves.toMatchObject({
      documentId: null,
      documentDeletedAt: deletedAt,
    })
  })

  it('keeps a Document within the retention period of its Workspace', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Fresh Foods')
    const received = await receiveFailedInvoice(into)

    await deleteAt(
      after(received.document.receivedAt, Duration.subtract(Duration.days(90), Duration.millis(1))),
    )

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      documentId: received.document.id,
      documentDeletedAt: null,
      document: { content: goldenInvoice },
    })
  })

  it('reads the retention period of the Workspace of the Document', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Short Memory Foods')

    await connection.db
      .update(workspaces)
      .set({ documentRetentionDays: 7 })
      .where(eq(workspaces.id, into.id))

    const received = await receiveFailedInvoice(into)
    const deletedAt = after(received.document.receivedAt, Duration.days(7))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      documentId: null,
      documentDeletedAt: deletedAt,
    })
  })

  it('keeps the Acknowledgement of an expired Document without its Document', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Answered Foods')
    const received = await receiveFailedInvoice(into)

    const [answer] = await connection.db
      .insert(acknowledgements)
      .values({
        workspaceId: into.id,
        documentId: received.document.id,
        tradingPartnerId: into.tradingPartnerId,
        notSentReason: 'noOutboundChannel',
      })
      .returning()

    await deleteAt(after(received.document.receivedAt, Duration.days(90)))

    await expect(
      connection.db
        .select()
        .from(acknowledgements)
        .where(eq(acknowledgements.id, answer?.id ?? '')),
    ).resolves.toEqual([{ ...answer, documentId: null }])
    await expect(
      connection.db.select().from(documents).where(eq(documents.id, received.document.id)),
    ).resolves.toEqual([])
  })

  it('keeps the Document of a Run in flight', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Busy Foods')
    const received = await receiveInvoice(into)

    await deleteAt(after(received.document.receivedAt, Duration.days(90)))

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      status: 'received',
      documentId: received.document.id,
      documentDeletedAt: null,
      document: { content: goldenInvoice },
    })
  })

  it('deletes every expired Document in batches within one sweep', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Backlog Foods')

    const received = [
      await receiveFailedInvoice(into),
      await receiveFailedInvoice(into),
      await receiveFailedInvoice(into),
    ]

    const deletedAt = after(received[2]?.document.receivedAt ?? new Date(), Duration.days(90))

    await at(
      deletedAt,
      deleteExpiredDocumentsInBatchesOf(1).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

    for (const { id } of received) {
      await expect(readRun(connection.db, id)).resolves.toMatchObject({
        documentId: null,
        documentDeletedAt: deletedAt,
      })
    }
  })

  it('keeps the link of a Reprocess and expires every Run of the Document', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Reprocessed Foods')
    const replaced = await receiveFailedInvoice(into)
    const { runId } = await reprocess(into, replaced.id)

    await failAtMapping(into, runId)

    const deletedAt = after(replaced.document.receivedAt, Duration.days(90))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, replaced.id)).resolves.toMatchObject({
      documentId: null,
      documentDeletedAt: deletedAt,
    })
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      replacesRunId: replaced.id,
      documentId: null,
      documentDeletedAt: deletedAt,
    })
  })

  it('keeps the link of a Duplicate to its original Run', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Copied Foods')
    const original = await receiveFailedInvoice(into)
    const copy = await receiveInvoice(into)

    await connection.db
      .update(runs)
      .set({ status: 'duplicate', duplicateOfRunId: original.id })
      .where(eq(runs.id, copy.id))

    const deletedAt = after(copy.document.receivedAt, Duration.days(90))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, original.id)).resolves.toMatchObject({
      documentId: null,
      documentDeletedAt: deletedAt,
    })
    await expect(readRun(connection.db, copy.id)).resolves.toMatchObject({
      status: 'duplicate',
      duplicateOfRunId: original.id,
      documentId: null,
      documentDeletedAt: deletedAt,
    })
  })

  it('waits for a Reprocess that locked its Run and keeps the Document for the new Run', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Racing Foods')
    const replaced = await receiveFailedInvoice(into)

    const waitsForLock = async () => {
      const [waiting] = await connection.db.execute<{ count: number }>(sql`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`)

      return waiting?.count ?? 0
    }

    let deleting: Promise<void> | undefined

    // Locks and inserts as reprocessRun does, with the sweep started in between.
    const started = await connection.db.transaction(async (tx) => {
      await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, replaced.id)).for('update')

      deleting = deleteAt(after(replaced.document.receivedAt, Duration.days(90)))

      await vi.waitFor(async () => expect(await waitsForLock()).toBeGreaterThan(0), {
        timeout: 2000,
        interval: 20,
      })

      const [created] = await tx
        .insert(runs)
        .values({
          workspaceId: into.id,
          documentId: replaced.document.id,
          flowId: replaced.flowId,
          tradingPartnerId: replaced.tradingPartnerId,
          mappingVersionId: into.mappingVersionId,
          manualSubmission: replaced.manualSubmission,
          messageIndex: replaced.messageIndex,
          replacesRunId: replaced.id,
        })
        .returning({ id: runs.id })

      return created
    })

    await deleting

    await expect(readRun(connection.db, replaced.id)).resolves.toMatchObject({
      documentId: replaced.document.id,
      documentDeletedAt: null,
    })
    await expect(readRun(connection.db, started?.id ?? '')).resolves.toMatchObject({
      status: 'received',
      documentId: replaced.document.id,
    })
  })

  it('runs with the sweep of Runs', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Swept Foods')
    const received = await receiveFailedInvoice(into)

    const sweeping = Effect.runFork(
      Effect.gen(function* () {
        yield* TestClock.setTime(after(received.document.receivedAt, Duration.days(90)).getTime())
        yield* sweepRunsEvery({ interval: '1 hour', stuckAfter: '10 minutes' })
      }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
        Effect.provide(TestClock.layer()),
      ),
    )

    try {
      await vi.waitFor(
        async () => {
          await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
            documentId: null,
          })
        },
        { timeout: 2000, interval: 20 },
      )
    } finally {
      await Effect.runPromise(Fiber.interrupt(sweeping))
    }
  })
})

describe('the Reprocess of a Run whose Document expired', () => {
  it('is refused because the Document expired', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Forgotten Foods')
    const received = await receiveInvoice(into)

    await failAtMapping(into, received.id)
    await deleteAt(after(received.document.receivedAt, Duration.days(90)))

    const refused = await refusedReprocess(into, received.id)

    expect(refused).toBeInstanceOf(RunNotReprocessable)
    expect(refused.message).toBe(
      'The Document of the Run expired, so the Run cannot be reprocessed',
    )
  })

  it('is unavailable for a Run whose Document expired', () => {
    const failed = {
      status: 'failed' as const,
      failureStage: 'mapping' as const,
      direction: 'outbound' as const,
      problem: { reason: 'defect' as const },
      mappingVersionId: 'a mapping version',
    }

    expect(isReprocessable({ ...failed, documentDeletedAt: null })).toBe(true)
    expect(isReprocessable({ ...failed, documentDeletedAt: new Date() })).toBe(false)
  })
})

describe('the processing of a Run that lost its Document', () => {
  it('fails the Run at its first open step on a defect', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Late Foods')
    const received = await receiveInvoice(into)

    // Only a race lets the Document of a Run in flight expire.
    await connection.db
      .update(runs)
      .set({ documentId: null, documentDeletedAt: new Date() })
      .where(eq(runs.id, received.id))
    await Effect.runPromise(
      processRun({ workspaceId: into.id, runId: received.id }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: { code: 'processingDefect' },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
  })
})
