import { eq } from 'drizzle-orm'
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
    const received = await receiveInvoice(into)
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

  it('keeps a Document within the retention period of its Workspace', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Fresh Foods')
    const received = await receiveInvoice(into)

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

    const received = await receiveInvoice(into)
    const deletedAt = after(received.document.receivedAt, Duration.days(7))

    await deleteAt(deletedAt)

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      documentId: null,
      documentDeletedAt: deletedAt,
    })
  })

  it('keeps the Acknowledgement of an expired Document without its Document', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Answered Foods')
    const received = await receiveInvoice(into)

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

  it('runs with the sweep of Runs', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Swept Foods')
    const received = await receiveInvoice(into)

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

  const reprocess = (into: InvoiceWorkspace, runId: string) =>
    Effect.runPromise(
      reprocessRun({ workspaceId: into.id, runId, mappingVersionId: into.mappingVersionId }).pipe(
        Effect.flip,
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

  it('is refused because the Document expired', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Forgotten Foods')
    const received = await receiveInvoice(into)

    await failAtMapping(into, received.id)
    await deleteAt(after(received.document.receivedAt, Duration.days(90)))

    const refused = await reprocess(into, received.id)

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

describe('the processing of a Run whose Document expired', () => {
  it('fails the Run at its first open step because its Document expired', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Late Foods')
    const received = await receiveInvoice(into)

    await deleteAt(after(received.document.receivedAt, Duration.days(90)))
    await Effect.runPromise(
      processRun({ workspaceId: into.id, runId: received.id }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

    await expect(readRun(connection.db, received.id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: {
        code: 'documentExpired',
        message: 'The Document expired before the Run was processed',
      },
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
