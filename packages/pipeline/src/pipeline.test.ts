import { eq } from 'drizzle-orm'
import { type Duration, Effect, Exit, Fiber } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { channels, connect, type Connection, documents, flows } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import {
  type ArrivingDocument,
  bullmqRunQueue,
  processRun,
  queueReceivedRunsEvery,
  ReceiptRejected,
  receive,
} from './index'
import {
  golden,
  goldenInvoice,
  goldenInvoicMessage,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
} from './testing'

let testDatabase: TestDatabase

let connection: Connection

let workspace: InvoiceWorkspace

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

describe('the receipt of a Document', () => {
  it('stores the Document and queues one received Run on the Flow of the Channel', async () => {
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId: workspace.inboundChannelId,
        fileName: 'invoice.json',
        content: goldenInvoice,
        manualSubmission: true,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.notRouted).toEqual([])
    expect(receipt.runs).toHaveLength(1)
    expect(queue.queued).toEqual([{ workspaceId: workspace.id, runId: receipt.runs[0]?.id }])

    await expect(readRun(connection.db, receipt.runs[0]?.id ?? '')).resolves.toMatchObject({
      status: 'received',
      manualSubmission: true,
      flowId: workspace.flowId,
      tradingPartnerId: workspace.tradingPartnerId,
      failureStage: null,
      output: null,
      document: { fileName: 'invoice.json', content: goldenInvoice },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'pending', startedAt: null, finishedAt: null },
        { stage: 'validation', status: 'pending', startedAt: null, finishedAt: null },
        { stage: 'delivery', status: 'pending', startedAt: null, finishedAt: null },
      ],
    })
  })

  it('answers with the Runs not queued when the Run queue is unreachable and keeps them received', async () => {
    const unreachable = bullmqRunQueue('redis://127.0.0.1:1', { timeout: '200 millis' })

    try {
      const receipt = await Effect.runPromise(
        receive({
          workspaceId: workspace.id,
          channelId: workspace.inboundChannelId,
          fileName: 'unqueued.json',
          content: goldenInvoice,
          manualSubmission: true,
        }).pipe(pipelineServices(connection.db, unreachable)),
      )

      const runId = receipt.runs[0]?.id ?? ''

      expect(receipt.notQueued).toEqual([runId])
      await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'received' })
    } finally {
      await unreachable.close()
    }
  })

  const rejection = async (arriving: Partial<ArrivingDocument>) => {
    const queue = inMemoryRunQueue()

    const exit = await Effect.runPromiseExit(
      receive({
        workspaceId: workspace.id,
        channelId: workspace.inboundChannelId,
        fileName: 'invoice.json',
        content: goldenInvoice,
        manualSubmission: true,
        ...arriving,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(queue.queued).toEqual([])

    return exit
  }

  it('rejects a Channel that does not exist', async () => {
    expect(await rejection({ channelId: '00000000-0000-4000-8000-000000000000' })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'unknownChannel' })),
    )
  })

  it('rejects a Channel of another Workspace', async () => {
    const other = await seedInvoiceWorkspace(connection.db, 'Hanse Retail')

    expect(await rejection({ channelId: other.inboundChannelId })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'unknownChannel' })),
    )
  })

  it('rejects an outbound Channel', async () => {
    expect(await rejection({ channelId: workspace.outboundChannelId })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'outboundChannel' })),
    )
  })

  it('rejects an inbound Channel without a Flow and stores no Document', async () => {
    const [channel] = await connection.db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: 'webhook',
        direction: 'inbound',
        name: 'Unused webhook',
        rateLimitPerMinute: 60,
        encryptedWebhookToken: 'encrypted',
        webhookTokenLastFour: 'efgh',
      })
      .returning()

    expect(await rejection({ channelId: channel?.id ?? '' })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'noFlow' })),
    )
    await expect(
      connection.db
        .select()
        .from(documents)
        .where(eq(documents.channelId, channel?.id ?? '')),
    ).resolves.toEqual([])
  })

  it('queues one Run per routed Message of an Interchange and lists the others as not routed', async () => {
    const [channel] = await connection.db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: 'sftp',
        direction: 'inbound',
        name: 'Hanse Retail outbox',
        host: 'sftp.example.com',
        port: 22,
        username: 'nordwind',
        remotePath: '/out',
        authentication: 'password',
        encryptedCredential: 'encrypted',
        pollingIntervalMinutes: 1,
      })
      .returning()

    const channelId = channel?.id ?? ''

    await connection.db.insert(flows).values({
      workspaceId: workspace.id,
      tradingPartnerId: workspace.tradingPartnerId,
      messageType: 'INVOIC',
      name: 'Invoices from the outbox',
      inboundChannelId: channelId,
      destinationChannelId: workspace.outboundChannelId,
      mappingVersionId: workspace.mappingVersionId,
    })

    const message = (name: string) =>
      golden(name, 'latin1')
        .split('\n')
        .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

    const interchange = [
      golden('invoic-reference.edi', 'latin1').split('\n')[0],
      ...message('invoic-reference.edi'),
      ...message('orders-reference.edi'),
      ...message('invoic-reference.edi'),
      "UNZ+3+00000001'",
    ].join('\n')

    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'interchange.edi',
        content: interchange,
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.notRouted).toEqual([{ messageType: 'ORDERS' }])
    expect(receipt.runs).toHaveLength(2)
    expect(receipt.runs.every((run) => run.documentId === receipt.document.id)).toBe(true)
    expect(receipt.runs.every((run) => !run.manualSubmission)).toBe(true)
    expect(queue.queued.map(({ runId }) => runId)).toEqual(receipt.runs.map(({ id }) => id))

    const ordersOnly = [
      golden('orders-reference.edi', 'latin1').split('\n')[0],
      ...message('orders-reference.edi'),
      "UNZ+1+00000001'",
    ].join('\n')

    expect(await rejection({ channelId, content: ordersOnly })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'noRoutedMessage' })),
    )
  })

  const channelWithFlows = async (messageTypes: Array<'INVOIC' | 'DESADV' | 'ORDERS'>) => {
    const [channel] = await connection.db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: 'webhook',
        direction: 'inbound',
        name: 'Shop webhook',
        rateLimitPerMinute: 60,
        encryptedWebhookToken: 'encrypted',
        webhookTokenLastFour: 'ijkl',
      })
      .returning()

    const channelId = channel?.id ?? ''

    const created = await connection.db
      .insert(flows)
      .values(
        messageTypes.map((messageType, index) => ({
          workspaceId: workspace.id,
          tradingPartnerId: workspace.tradingPartnerId,
          messageType,
          name: `${index + 1}. ${messageType} from the shop`,
          inboundChannelId: channelId,
          destinationChannelId: workspace.outboundChannelId,
          mappingVersionId: workspace.mappingVersionId,
        })),
      )
      .returning()

    return { channelId, flows: created }
  }

  const storedDocuments = (channelId: string) =>
    connection.db.select().from(documents).where(eq(documents.channelId, channelId))

  it('tries to queue every Run of a Document when one is not queued', async () => {
    const { channelId } = await channelWithFlows(['INVOIC'])

    const invoice = golden('invoic-reference.edi', 'latin1')
      .split('\n')
      .filter((line) => line !== '')

    const twoInvoices = [
      ...invoice.filter((line) => line.startsWith('UNB')),
      ...invoice.filter((line) => !/^UN[BZ]/.test(line)),
      ...invoice.filter((line) => !/^UN[BZ]/.test(line)),
      "UNZ+2+00000001'",
    ].join('\n')

    const queue = inMemoryRunQueue({ failures: 1 })

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'two-invoices.edi',
        content: twoInvoices,
        manualSubmission: true,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    const [first, second] = receipt.runs

    expect(receipt.notQueued).toEqual([first?.id])
    expect(queue.queued).toEqual([{ workspaceId: workspace.id, runId: second?.id }])
  })

  it('routes a Document without Message Types to the only outbound Flow of the Channel', async () => {
    const { channelId, flows: created } = await channelWithFlows(['ORDERS', 'INVOIC'])
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'invoice.json',
        content: goldenInvoice,
        manualSubmission: true,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.runs.map(({ flowId }) => flowId)).toEqual(
      created.filter(({ messageType }) => messageType === 'INVOIC').map(({ id }) => id),
    )
  })

  it('rejects a Document without Message Types when several outbound Flows could take it', async () => {
    const { channelId } = await channelWithFlows(['INVOIC', 'DESADV'])

    expect(await rejection({ channelId })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'ambiguousFlow' })),
    )
    await expect(storedDocuments(channelId)).resolves.toEqual([])
  })

  it('rejects a Document routed to an inbound Flow and stores nothing', async () => {
    const { channelId } = await channelWithFlows(['ORDERS'])

    const orders = [
      golden('orders-reference.edi', 'latin1').split('\n')[0],
      ...golden('orders-reference.edi', 'latin1')
        .split('\n')
        .filter((line) => line !== '' && !/^UN[BZ]/.test(line)),
      "UNZ+1+00000001'",
    ].join('\n')

    expect(await rejection({ channelId, content: orders })).toStrictEqual(
      Exit.fail(new ReceiptRejected({ reason: 'inboundNotProcessed' })),
    )
    await expect(storedDocuments(channelId)).resolves.toEqual([])
  })
})

const receiveInvoice = async (content = goldenInvoice, queue = inMemoryRunQueue()) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: workspace.id,
      channelId: workspace.inboundChannelId,
      fileName: 'invoice.json',
      content,
      manualSubmission: true,
    }).pipe(pipelineServices(connection.db, queue)),
  )

  return { queue, runId: receipt.runs[0]?.id ?? '' }
}

const processQueued = async (queue: ReturnType<typeof inMemoryRunQueue>) => {
  for (const queued of queue.queued) {
    await Effect.runPromise(processRun(queued).pipe(pipelineServices(connection.db, queue)))
  }
}

type ReadRun = Awaited<ReturnType<typeof readRun>>

// A step that ran has both timings; the database rejects a finish before the start.
const ranStages = (run: ReadRun) =>
  (run?.steps ?? []).flatMap(({ stage, startedAt, finishedAt }) =>
    startedAt !== null && finishedAt !== null ? [stage] : [],
  )

const parsedInvoice: unknown = JSON.parse(goldenInvoice)

const invoiceDocument = z.looseObject({ lines: z.array(z.looseObject({})) }).parse(parsedInvoice)

describe('the sweep of received Runs', () => {
  const sweep = async (
    queue: ReturnType<typeof inMemoryRunQueue>,
    interval: Duration.Input,
    runId: string,
  ) => {
    const sweeping = Effect.runFork(
      queueReceivedRunsEvery(interval).pipe(pipelineServices(connection.db, queue)),
    )

    try {
      await vi.waitFor(
        () => {
          expect(queue.queued).toContainEqual({ workspaceId: workspace.id, runId })
        },
        { timeout: 2000, interval: 20 },
      )
    } finally {
      await Effect.runPromise(Fiber.interrupt(sweeping))
    }
  }

  it('queues a Run left received at once', async () => {
    const { runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue({ failures: 1 }))

    await sweep(inMemoryRunQueue(), '1 hour', runId)
  })

  it('tries again at the next interval after a failed sweep', async () => {
    const { runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue({ failures: 1 }))

    await sweep(inMemoryRunQueue({ failures: 1 }), '20 millis', runId)
  })
})

describe('the processing of a Run', () => {
  it('maps the Document with the pinned Mapping Version and keeps the valid INVOIC as output', async () => {
    const { queue, runId } = await receiveInvoice()

    await processQueued(queue)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'processing',
      failureStage: null,
      error: null,
      problem: null,
      mappingVersionId: workspace.mappingVersionId,
      businessReference: '4711',
      output: goldenInvoicMessage,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'pending' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping', 'validation'])

    const [receipt, mapping, validation] = run?.steps ?? []

    expect(receipt?.finishedAt?.getTime()).toBeLessThanOrEqual(mapping?.startedAt?.getTime() ?? 0)
    expect(mapping?.finishedAt?.getTime()).toBeLessThanOrEqual(
      validation?.startedAt?.getTime() ?? 0,
    )
  })

  it('stops a Run with an invalid INVOIC at validation and keeps no output', async () => {
    const tooLongInvoiceNumber = JSON.stringify({
      ...invoiceDocument,
      invoiceNumber: 'INV-'.repeat(10),
    })

    const { queue, runId } = await receiveInvoice(tooLongInvoiceNumber)

    await processQueued(queue)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      mappingVersionId: workspace.mappingVersionId,
      output: null,
      error: {
        code: 'too-long-element',
        position: { segment: 2, tag: 'BGM', element: 2, component: null },
      },
      problem: { reason: 'invalidContent', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'failed' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping', 'validation'])
  })

  it('stops a Run whose Mapping Version fails at mapping and names the Mapping to fix', async () => {
    const unknownUnit = JSON.stringify({
      ...invoiceDocument,
      lines: invoiceDocument.lines.map((line) => ({ ...line, unit: 'KG' })),
    })

    const { queue, runId } = await receiveInvoice(unknownUnit)

    await processQueued(queue)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      output: null,
      error: { code: 'noLookupMatch', position: null },
      problem: {
        reason: 'missingCode',
        fixTarget: { kind: 'mapping', mappingId: workspace.mappingId },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping'])
  })

  it('stops a Run with an unreadable Document at mapping', async () => {
    const { queue, runId } = await receiveInvoice('not json')

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      output: null,
      error: { code: 'invalidJson', position: null },
      problem: { reason: 'unreadable', fixTarget: null },
    })
  })

  it('processes a Run handed out twice only once', async () => {
    const { queue, runId } = await receiveInvoice()

    await processQueued(queue)

    const processed = await readRun(connection.db, runId)

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toEqual(processed)
  })
})
