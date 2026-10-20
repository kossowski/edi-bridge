import { and, eq, sql } from 'drizzle-orm'
import { Cause, Duration, Effect, Exit, Fiber, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  DeliveryFailed,
  secretBox,
  secretKeyBytes,
  sftpChannelDelivery,
} from '@edi-bridge/channels'
import {
  mismatchingHostKeyFingerprint,
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
} from '@edi-bridge/channels/testing'
import { type CharacterSet, withCheckDigit } from '@edi-bridge/contracts'
import {
  acknowledgements,
  channels,
  connect,
  type Connection,
  documents,
  documentStructures,
  flows,
  postgresDocumentStorage,
  lookupTableEntries,
  mappings,
  mappingVersions,
  runs,
  runSteps,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import {
  type ArrivingDocument,
  bullmqRunQueue,
  channelDelivery,
  type DeliveryService,
  decodeDocument,
  deleteExpiredDocuments,
  LiveEvents,
  type LiveEventsService,
  markOverdueInterchanges,
  processRun,
  publishRunChanges,
  ReceiptRejected,
  receive,
  reprocessRun,
  retryRun,
  RunNotRetryable,
  sendAcknowledgements,
  sendTestInterchange,
  sweepRunsEvery,
  sweepStuckRuns,
} from './index'
import { contentHashOf } from './receive'
import { type Database, type Delivery, Documents, type RunQueue } from './services'
import {
  addContrlFlow,
  addOrdersFlow,
  deliverOverSftp,
  markSeeded,
  golden,
  goldenInvoice,
  goldenInvoicMessage,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  receiveOverSftp,
  liveStatusesOf,
  testLiveEvents,
  seedInvoiceWorkspace,
  testSecrets,
} from './testing'

let testDatabase: TestDatabase

let sftp: TestSftpServer

let erp: TestErp

let connection: Connection

let workspace: InvoiceWorkspace

let channelId: string

const sftpLogin = () => ({
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  password: sftp.password,
  remotePath: '/upload',
})

beforeAll(async () => {
  ;[testDatabase, sftp, erp] = await Promise.all([
    startTestDatabase(),
    startTestSftpServer(),
    startTestErp(),
  ])
  connection = connect(testDatabase.url)
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
  channelId = await deliverOverSftp(connection.db, workspace, sftpLogin())
}, 180_000)

afterAll(async () => {
  await connection.close()
  await Promise.all([testDatabase.stop(), sftp.stop(), erp.stop()])
})

describe('the receipt of a Document', () => {
  it('stores the Document and queues one received Run on the Flow of the Channel', async () => {
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId: workspace.inboundChannelId,
        fileName: 'invoice.json',
        content: { text: goldenInvoice },
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
      messageIndex: null,
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
          content: { text: goldenInvoice },
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

  const storedDocuments = (channelId: string) =>
    connection.db.select().from(documents).where(eq(documents.channelId, channelId))

  const keptDocumentId = async (channelId: string) =>
    (await storedDocuments(channelId)).find(({ fileName }) => fileName === 'invoice.json')?.id ?? ''

  const rejection = async (arriving: Partial<ArrivingDocument>) => {
    const queue = inMemoryRunQueue()

    const exit = await Effect.runPromiseExit(
      receive({
        workspaceId: workspace.id,
        channelId: workspace.inboundChannelId,
        fileName: 'invoice.json',
        content: { text: goldenInvoice },
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
    await expect(storedDocuments(workspace.outboundChannelId)).resolves.toEqual([])
  })

  it('rejects an inbound Channel without a Flow and keeps the Document', async () => {
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

    const channelId = channel?.id ?? ''
    const exit = await rejection({ channelId })

    expect(exit).toStrictEqual(
      Exit.fail(
        new ReceiptRejected({ reason: 'noFlow', documentId: await keptDocumentId(channelId) }),
      ),
    )
    await expect(storedDocuments(channelId)).resolves.toMatchObject([
      { fileName: 'invoice.json', content: goldenInvoice },
    ])
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
        content: { text: interchange },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.notRouted).toEqual([{ messageType: 'ORDERS' }])
    expect(receipt.runs.map(({ messageIndex }) => messageIndex)).toEqual([1, 3])
    expect(receipt.runs.every((run) => run.documentId === receipt.document.id)).toBe(true)
    expect(receipt.runs.every((run) => !run.manualSubmission)).toBe(true)
    expect(queue.queued.map(({ runId }) => runId)).toEqual(receipt.runs.map(({ id }) => id))

    const ordersOnly = [
      golden('orders-reference.edi', 'latin1').split('\n')[0],
      ...message('orders-reference.edi'),
      "UNZ+1+00000001'",
    ].join('\n')

    const exit = await rejection({ channelId, content: { text: ordersOnly } })

    expect(exit).toStrictEqual(
      Exit.fail(
        new ReceiptRejected({
          reason: 'noRoutedMessage',
          documentId: await keptDocumentId(channelId),
        }),
      ),
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

  it('tries to queue every Run of a Document when one is not queued', async () => {
    const { channelId } = await channelWithFlows(['INVOIC'])

    const invoice = golden('invoic-reference.edi', 'latin1')
      .split('\n')
      .filter((line) => line !== '')

    // A control reference of its own, so the Interchange is no Duplicate of an earlier test's.
    const twoInvoices = [
      ...invoice
        .filter((line) => line.startsWith('UNB'))
        .map((line) => line.replace("+00000001'", "+00000002'")),
      ...invoice.filter((line) => !/^UN[BZ]/.test(line)),
      ...invoice.filter((line) => !/^UN[BZ]/.test(line)),
      "UNZ+2+00000002'",
    ].join('\n')

    const queue = inMemoryRunQueue({ failures: 1 })

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'two-invoices.edi',
        content: { text: twoInvoices },
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
        content: { text: goldenInvoice },
        manualSubmission: true,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.runs.map(({ flowId }) => flowId)).toEqual(
      created.filter(({ messageType }) => messageType === 'INVOIC').map(({ id }) => id),
    )
  })

  it('rejects a Document without Message Types when several outbound Flows could take it and keeps it', async () => {
    const { channelId } = await channelWithFlows(['INVOIC', 'DESADV'])
    const exit = await rejection({ channelId })

    expect(exit).toStrictEqual(
      Exit.fail(
        new ReceiptRejected({
          reason: 'ambiguousFlow',
          documentId: await keptDocumentId(channelId),
        }),
      ),
    )
  })

  const ordersMessage = golden('orders-reference.edi', 'latin1')
    .split('\n')
    .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

  const ordersInterchange = (messages: string[][]) =>
    [
      golden('orders-reference.edi', 'latin1').split('\n')[0],
      ...messages.flat(),
      `UNZ+${messages.length}+00000001'`,
    ].join('\n')

  it('receives an inbound Interchange of three Messages as three Runs linked to its Document', async () => {
    const { channelId, flows: created } = await channelWithFlows(['ORDERS'])
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'orders.edi',
        content: { text: ordersInterchange([ordersMessage, ordersMessage, ordersMessage]) },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(receipt.notRouted).toEqual([])
    expect(queue.queued).toEqual(
      receipt.runs.map(({ id }) => ({ workspaceId: workspace.id, runId: id })),
    )
    expect(
      receipt.runs.map(({ documentId, flowId, messageIndex }) => ({
        documentId,
        flowId,
        messageIndex,
      })),
    ).toEqual(
      [1, 2, 3].map((messageIndex) => ({
        documentId: receipt.document.id,
        flowId: created[0]?.id,
        messageIndex,
      })),
    )
    await expect(readRun(connection.db, receipt.runs[0]?.id ?? '')).resolves.toMatchObject({
      status: 'received',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'pending' },
        { stage: 'validation', status: 'pending' },
        { stage: 'mapping', status: 'pending' },
        { stage: 'delivery', status: 'pending' },
      ],
    })
  })

  it('receives a broken Message of an Interchange as a Run of its own', async () => {
    const { channelId } = await channelWithFlows(['ORDERS'])

    const withoutSegment = ordersMessage.filter((_, index) => index !== 2)

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'orders.edi',
        content: { text: ordersInterchange([ordersMessage, withoutSegment, ordersMessage]) },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, inMemoryRunQueue())),
    )

    expect(receipt.runs.map(({ messageIndex }) => messageIndex)).toEqual([1, 2, 3])
  })

  const ordersFromTwoPartners = async (glns: [string, string]) => {
    const { channelId, flows: invoic } = await channelWithFlows(['INVOIC'])

    const partners = await connection.db
      .insert(tradingPartners)
      .values(
        glns.map((gln) => ({
          workspaceId: workspace.id,
          name: `Partner ${gln}`,
          gln,
          characterSet: 'UNOC' as const,
          acknowledgementTimeLimitHours: 24,
        })),
      )
      .returning()

    const orders = await connection.db
      .insert(flows)
      .values(
        partners.map((partner) => ({
          workspaceId: workspace.id,
          tradingPartnerId: partner.id,
          messageType: 'ORDERS' as const,
          name: `ORDERS from ${partner.name}`,
          inboundChannelId: channelId,
          destinationChannelId: workspace.outboundChannelId,
          mappingVersionId: workspace.mappingVersionId,
        })),
      )
      .returning()

    return { channelId, orders, invoic }
  }

  const interchangeFrom = (sender: string, messages: string[][]) =>
    [
      `UNB+UNOC:3+${sender}:14+4012345000009:14+000324:1200+00000001'`,
      ...messages.flat(),
      `UNZ+${messages.length}+00000001'`,
    ].join('\n')

  it('routes an inbound Message to the Flow of the Trading Partner that sent the Interchange', async () => {
    const { channelId, orders } = await ordersFromTwoPartners([
      withCheckDigit('430000000001'),
      withCheckDigit('430000000002'),
    ])

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'orders.edi',
        content: { text: interchangeFrom(withCheckDigit('430000000002'), [ordersMessage]) },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, inMemoryRunQueue())),
    )

    expect(receipt.notRouted).toEqual([])
    expect(
      receipt.runs.map(({ flowId, tradingPartnerId }) => ({ flowId, tradingPartnerId })),
    ).toEqual([{ flowId: orders[1]?.id, tradingPartnerId: orders[1]?.tradingPartnerId }])
  })

  it('lists a Message as not routed when several Flows of its Message Type share the Channel and none is from the sender', async () => {
    const { channelId, invoic } = await ordersFromTwoPartners([
      withCheckDigit('430000000003'),
      withCheckDigit('430000000004'),
    ])

    const invoicMessage = golden('invoic-reference.edi', 'latin1')
      .split('\n')
      .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId,
        fileName: 'interchange.edi',
        content: {
          text: interchangeFrom(withCheckDigit('430000000005'), [invoicMessage, ordersMessage]),
        },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, inMemoryRunQueue())),
    )

    expect(receipt.notRouted).toEqual([{ messageType: 'ORDERS' }])
    expect(receipt.runs.map(({ flowId, messageIndex }) => ({ flowId, messageIndex }))).toEqual([
      { flowId: invoic[0]?.id, messageIndex: 1 },
    ])
  })
})

const receiveInvoice = async (
  content = goldenInvoice,
  queue = inMemoryRunQueue(),
  into: InvoiceWorkspace = workspace,
) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: into.id,
      channelId: into.inboundChannelId,
      fileName: 'invoice.json',
      content: { text: content },
      manualSubmission: true,
    }).pipe(pipelineServices(connection.db, queue)),
  )

  return { queue, runId: receipt.runs[0]?.id ?? '' }
}

const sftpDelivery: DeliveryService = sftpChannelDelivery({
  secrets: testSecrets,
  timeoutMs: 1500,
})

const deliveryByChannelType = channelDelivery({ secrets: testSecrets, timeoutMs: 1500 })

beforeEach(() => {
  erp.received.length = 0
})

const processQueued = async (
  queue: ReturnType<typeof inMemoryRunQueue>,
  delivery = sftpDelivery,
) => {
  for (const queued of queue.queued) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(connection.db, queue, delivery)),
    )
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

// An INVOIC whose BGM document number is longer than the element allows, so validation fails.
const tooLongInvoiceNumber = JSON.stringify({
  ...invoiceDocument,
  invoiceNumber: 'INV-'.repeat(10),
})

// The stored Message with its UNH, so a segment position counted from UNH as 1 indexes it.
const storedSegments = z
  .object({
    header: z.looseObject({ tag: z.string() }),
    segments: z.array(z.looseObject({ tag: z.string() })),
  })
  .transform(({ header, segments }) => [header, ...segments])

describe('the sweep of received Runs', () => {
  const sweep = async (
    queue: ReturnType<typeof inMemoryRunQueue>,
    interval: Duration.Input,
    runId: string,
  ) => {
    const sweeping = Effect.runFork(
      sweepRunsEvery({ interval, stuckAfter: '10 minutes' }).pipe(
        pipelineServices(connection.db, queue),
      ),
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

const collectLogs = () => {
  const messages: unknown[] = []

  return { messages, logger: Logger.layer([Logger.make(({ message }) => messages.push(message))]) }
}

// A worker that stopped mid-Run leaves it processing, with its last change long ago.
const leaveStuck = async (runId: string) => {
  await connection.db.execute(
    sql`update runs set status = 'processing', updated_at = updated_at - interval '1 hour' where id = ${runId}`,
  )
  await connection.db.execute(sql`
    update run_steps
    set started_at = started_at - interval '1 hour', finished_at = finished_at - interval '1 hour'
    where run_id = ${runId}`)
}

const sweepStuck = async (queue = inMemoryRunQueue(), delivery = sftpDelivery) => {
  await Effect.runPromise(
    sweepStuckRuns('10 minutes').pipe(pipelineServices(connection.db, queue, delivery)),
  )

  return queue
}

describe('the sweep of stuck Runs', () => {
  it('queues a stuck Run whose steps after receipt never started again as received', async () => {
    const { runId } = await receiveInvoice()

    await leaveStuck(runId)

    const queue = await sweepStuck()

    expect(queue.queued).toEqual([{ workspaceId: workspace.id, runId }])
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'received',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'pending' },
        { stage: 'validation', status: 'pending' },
        { stage: 'delivery', status: 'pending' },
      ],
    })

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'delivered' })
  })

  it('leaves a Run processing within the bound', async () => {
    const { runId } = await receiveInvoice()

    await connection.db.update(runs).set({ status: 'processing' }).where(eq(runs.id, runId))

    const queue = await sweepStuck()

    expect(queue.queued).toEqual([])
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'processing' })
  })

  it('leaves a Run whose step started within the bound processing', async () => {
    const { runId } = await receiveInvoice()

    await leaveStuck(runId)
    await connection.db.execute(
      sql`update run_steps set status = 'running', started_at = now() where run_id = ${runId} and stage = 'mapping'`,
    )

    const queue = await sweepStuck()

    expect(queue.queued).toEqual([])
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'processing' })
  })

  it('fails a stuck Run as a defect at its running step', async () => {
    const { runId } = await receiveInvoice()

    await connection.db.execute(
      sql`update run_steps set status = 'running', started_at = now() where run_id = ${runId} and stage = 'mapping'`,
    )
    await leaveStuck(runId)

    const queue = await sweepStuck()

    expect(queue.queued).toEqual([])

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: { code: 'processingDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping'])
  })

  // The worker stops while the Channel takes the Interchange.
  const stopInDelivery = async (into: InvoiceWorkspace) => {
    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)
    const [queued] = queue.queued
    const { promise: handingOver, resolve: handOverStarted } = Promise.withResolvers<void>()

    const processing = Effect.runFork(
      processRun(queued ?? { workspaceId: into.id, runId }).pipe(
        pipelineServices(connection.db, queue, () => {
          handOverStarted()

          return Effect.never
        }),
      ),
    )

    // The Interchange is stored before the hand-over, so the Run changes no more after it starts.
    try {
      await handingOver
    } finally {
      await Effect.runPromise(Fiber.interrupt(processing))
    }

    return runId
  }

  it('fails a Run stuck in its delivery at delivery, so a Retry delivers it', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Stalled Foods')
    const remotePath = '/upload/stalled'

    await sftp.exec(
      `mkdir ${sftp.home}${remotePath} && chown ${sftp.username} ${sftp.home}${remotePath}`,
    )
    await deliverOverSftp(connection.db, into, { ...sftpLogin(), remotePath })

    const runId = await stopInDelivery(into)

    await leaveStuck(runId)
    await sweepStuck()

    const failed = await readRun(connection.db, runId)

    expect(failed).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'processingDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })

    const queue = inMemoryRunQueue()

    await Effect.runPromise(
      retryRun({ workspaceId: into.id, runId }).pipe(pipelineServices(connection.db, queue)),
    )
    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'delivered' })
    await expect(
      remoteFile(`${remotePath}/INVOIC-${String(failed?.controlReference)}.edi`),
    ).resolves.toBe(failed?.output)
  })

  it('fails a stuck Run already handed over at delivery, so its Retry records it delivered without handing it over again', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Handed Foods')

    await deliverOverSftp(connection.db, into, sftpLogin())

    const runId = await stopInDelivery(into)

    await connection.db.execute(sql`update runs set handed_over_at = now() where id = ${runId}`)
    await leaveStuck(runId)
    await sweepStuck()

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      problem: { reason: 'defect', fixTarget: null },
    })

    const queue = inMemoryRunQueue()
    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await Effect.runPromise(
      retryRun({ workspaceId: into.id, runId }).pipe(pipelineServices(connection.db, queue)),
    )
    await processQueued(queue, handOvers)

    expect(handOvers).not.toHaveBeenCalled()
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'delivered' })
  })

  it('keeps a Run failed when its stalled worker resumes the delivery after the sweep', async () => {
    const { queue, runId } = await receiveInvoice()
    const [queued] = queue.queued
    const { promise: resumed, resolve: resume } = Promise.withResolvers<void>()
    const { promise: handingOver, resolve: handOverStarted } = Promise.withResolvers<void>()

    // The worker stalls while the Channel takes the Interchange.
    const stalled = Effect.runPromise(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        pipelineServices(connection.db, queue, () => {
          handOverStarted()

          return Effect.promise(() => resumed)
        }),
      ),
    )

    await handingOver

    await leaveStuck(runId)
    await sweepStuck()
    resume()
    await stalled

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })
    // The Channel took the Document, so its Retry must not hand it over again.
    expect(run?.handedOverAt).not.toBeNull()
  })

  it('stops a stalled worker once the sweep released its Run to another worker', async () => {
    const { queue, runId } = await receiveInvoice()
    const [queued] = queue.queued
    const { promise: resumed, resolve: resume } = Promise.withResolvers<void>()
    const handOvers = vi.fn<DeliveryService>(() => Effect.void)
    const storage = postgresDocumentStorage(connection.db)

    // The worker stalls after its claim, before its first step starts.
    const stalled = Effect.runPromise(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        Effect.provideService(Documents, {
          ...storage,
          read: async (...args) => {
            await resumed

            return storage.read(...args)
          },
        }),
        pipelineServices(connection.db, queue, handOvers),
      ),
    )

    await vi.waitFor(
      async () => {
        expect(await readRun(connection.db, runId)).toMatchObject({ status: 'processing' })
      },
      { timeout: 2000, interval: 20 },
    )

    await leaveStuck(runId)
    await processQueued(await sweepStuck(), handOvers)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'delivered' })

    resume()
    await stalled

    expect(handOvers).toHaveBeenCalledOnce()
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'delivered',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
  })

  it('keeps the Interchange its Retry delivered when the stalled worker resumes building its own', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Rebuilt Foods')

    await deliverOverSftp(connection.db, into, sftpLogin())

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)
    const [queued] = queue.queued
    const { promise: resumed, resolve: resume } = Promise.withResolvers<void>()
    const { promise: building, resolve: buildStarted } = Promise.withResolvers<void>()
    const { db } = connection
    let hasStalled = false

    const isDelivering = async () => {
      const [delivery] = await db
        .select({ status: runSteps.status })
        .from(runSteps)
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, 'delivery')))

      return delivery?.status === 'running'
    }

    // The worker stalls as it claims the control reference of its Interchange.
    const transaction: typeof db.transaction = async (run, config) => {
      if (!hasStalled && (await isDelivering())) {
        hasStalled = true
        buildStarted()
        await resumed
      }

      return db.transaction(run, config)
    }

    // SAFETY: its prototype is the connection's database, so it has every member but its own transaction.
    const stallingDb: typeof db = Object.assign(Object.create(db) as typeof db, { transaction })

    const { messages, logger } = collectLogs()

    const stalled = Effect.runPromise(
      processRun(queued ?? { workspaceId: into.id, runId }).pipe(
        pipelineServices(stallingDb, queue, () => Effect.void),
        Effect.provide(logger),
      ),
    )

    await building
    await leaveStuck(runId)
    await sweepStuck()

    // The Workspace changes its GLN meanwhile, so the two workers build different Interchanges.
    await db
      .update(workspaces)
      .set({ gln: withCheckDigit('430000000099') })
      .where(eq(workspaces.id, into.id))

    const retried = inMemoryRunQueue()
    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await Effect.runPromise(
      retryRun({ workspaceId: into.id, runId }).pipe(pipelineServices(db, retried)),
    )
    await processQueued(retried, handOvers)

    resume()
    await stalled

    const delivered = handOvers.mock.calls[0]?.[1].content

    expect(handOvers).toHaveBeenCalledOnce()
    await expect(readRun(db, runId)).resolves.toMatchObject({
      status: 'delivered',
      output: delivered?.toString('latin1'),
    })
    expect(messages).toEqual([[`A stalled worker stopped processing Run ${runId}, which it lost`]])
  })

  it('leaves the Run to its new worker when the stalled worker stops on a defect', async () => {
    const { queue, runId } = await receiveInvoice()
    const [queued] = queue.queued
    const { promise: resumed, resolve: resume } = Promise.withResolvers<void>()
    const { promise: handingOver, resolve: handOverStarted } = Promise.withResolvers<void>()
    const { promise: handedOver, resolve: handOver } = Promise.withResolvers<void>()
    const storage = postgresDocumentStorage(connection.db)

    // The worker stalls after its claim and then loses its database connection.
    const stalled = Effect.runPromiseExit(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        Effect.provideService(Documents, {
          ...storage,
          read: async () => {
            await resumed

            throw new Error('The connection to the database was lost')
          },
        }),
        pipelineServices(connection.db, queue),
      ),
    )

    await vi.waitFor(
      async () => {
        expect(await readRun(connection.db, runId)).toMatchObject({ status: 'processing' })
      },
      { timeout: 2000, interval: 20 },
    )

    await leaveStuck(runId)

    const [requeued] = (await sweepStuck()).queued

    const processing = Effect.runPromise(
      processRun(requeued ?? { workspaceId: workspace.id, runId }).pipe(
        pipelineServices(connection.db, queue, () => {
          handOverStarted()

          return Effect.promise(() => handedOver)
        }),
      ),
    )

    await handingOver
    resume()

    const stopped = await stalled

    handOver()
    await processing

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'delivered',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    // It lost the Run, so its defect is logged as a lost Run instead.
    expect(Exit.isSuccess(stopped)).toBe(true)
  })

  it('reports the defect that stopped the worker when failing its Run fails too', async () => {
    const { queue, runId } = await receiveInvoice()
    const [queued] = queue.queued
    const storage = postgresDocumentStorage(connection.db)
    const { db } = connection
    const defect = new Error('The Document storage broke')
    let isDown = false

    const transaction: typeof db.transaction = (run, config) =>
      isDown
        ? Promise.reject(new Error('The connection to the database was lost'))
        : db.transaction(run, config)

    // SAFETY: its prototype is the connection's database, so it has every member but its own transaction.
    const downDb: typeof db = Object.assign(Object.create(db) as typeof db, { transaction })

    const { messages, logger } = collectLogs()

    const stopped = await Effect.runPromiseExit(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        Effect.provideService(Documents, {
          ...storage,
          read: () => {
            isDown = true

            return Promise.reject(defect)
          },
        }),
        pipelineServices(downDb, queue),
        Effect.provide(logger),
      ),
    )

    expect(Exit.isFailure(stopped) && Cause.squash(stopped.cause)).toBe(defect)
    expect(messages).toContainEqual([
      `Run ${runId} was not failed on its defect`,
      new Error('The connection to the database was lost'),
    ])
  })

  it('finishes a step that the sweep checks meanwhile without a deadlock', async () => {
    const { queue, runId } = await receiveInvoice()
    const [queued] = queue.queued
    const { promise: finishing, resolve: finishStarted } = Promise.withResolvers<void>()
    const { promise: locked, resolve: lock } = Promise.withResolvers<void>()
    const { db } = connection
    let isHandedOver = false
    let hasStalled = false

    // The worker stalls as it finishes the delivery step.
    const transaction: typeof db.transaction = async (run, config) => {
      if (isHandedOver && !hasStalled) {
        hasStalled = true
        finishStarted()
        await locked
      }

      return db.transaction(run, config)
    }

    // SAFETY: its prototype is the connection's database, so it has every member but its own transaction.
    const stallingDb: typeof db = Object.assign(Object.create(db) as typeof db, { transaction })

    const processing = Effect.runPromise(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        pipelineServices(stallingDb, queue, () =>
          Effect.sync(() => {
            isHandedOver = true
          }),
        ),
      ),
    )

    await finishing

    const waitsForLock = async () => {
      const [waiting] = await db.execute<{ count: number }>(sql`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`)

      return waiting?.count ?? 0
    }

    // The sweep locks the Run before its steps, as it does to fail a stuck Run.
    await db.transaction(async (tx) => {
      await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).for('update')
      lock()
      await vi.waitFor(async () => expect(await waitsForLock()).toBeGreaterThan(0), {
        timeout: 2000,
        interval: 20,
      })
      await tx
        .update(runSteps)
        .set({ status: 'running' })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, 'delivery')))
    })

    await processing

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'delivered' })
  })
})

const interchangeTime = (date: Date) =>
  date.toISOString().replace(/^\d\d(\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d).*$/, '$1$2$3:$4$5')

const invoicSegments = goldenInvoicMessage.split('\n').join('')

// UNOC is ISO 8859-1, so the file holds Latin-1 bytes.
const remoteFile = async (path: string) =>
  Buffer.from((await sftp.exec(`base64 ${sftp.home}${path}`)).output, 'base64').toString('latin1')

describe('the processing of a Run', () => {
  it('delivers the valid INVOIC in its own Interchange to the SFTP Channel', async () => {
    const { queue, runId } = await receiveInvoice()
    const before = new Date()

    await processQueued(queue)

    const after = new Date()
    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'delivered',
      failureStage: null,
      error: null,
      problem: null,
      mappingVersionId: workspace.mappingVersionId,
      businessReference: '4711',
      documentNumber: '87441',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping', 'validation', 'delivery'])

    const [receipt, mapping, validation, delivery] = run?.steps ?? []

    expect(receipt?.finishedAt?.getTime()).toBeLessThanOrEqual(mapping?.startedAt?.getTime() ?? 0)
    expect(mapping?.finishedAt?.getTime()).toBeLessThanOrEqual(
      validation?.startedAt?.getTime() ?? 0,
    )
    expect(validation?.finishedAt?.getTime()).toBeLessThanOrEqual(
      delivery?.startedAt?.getTime() ?? 0,
    )

    const reference = String(run?.controlReference)
    const time = /^UNB\+[^+]*\+[^+]*\+[^+]*\+([^+]*)\+/.exec(run?.output ?? '')?.[1]

    expect([interchangeTime(before), interchangeTime(after)]).toContain(time)
    expect(run?.output).toBe(
      `UNB+UNOC:3+4389876511114:14+4071615111111:14+${time}+${reference}'` +
        invoicSegments +
        `UNZ+1+${reference}'`,
    )

    const delivered = await remoteFile(`/upload/INVOIC-${reference}.edi`)

    expect(delivered).toBe(run?.output)
    expect(delivered.match(/UNH\+/g)).toHaveLength(1)
  })

  const invoiceDescribing = (...descriptions: string[]) =>
    JSON.stringify({
      ...invoiceDocument,
      lines: invoiceDocument.lines.map((line, index) => ({
        ...line,
        description: descriptions[index],
      })),
    })

  const sftpWorkspaceIn = async (
    name: string,
    characterSet: CharacterSet,
    remotePath = '/upload',
  ) => {
    const created = await seedInvoiceWorkspace(connection.db, name)

    await connection.db
      .update(tradingPartners)
      .set({ characterSet })
      .where(eq(tradingPartners.id, created.tradingPartnerId))
    await deliverOverSftp(connection.db, created, { ...sftpLogin(), remotePath })

    return created
  }

  it('declares the separators in a UNA when it delivers in UNOB', async () => {
    // Each Trading Partner counts its control references from 1, so a file name repeats across them.
    await sftp.exec(
      `mkdir ${sftp.home}/upload/unob && chown ${sftp.username} ${sftp.home}/upload/unob`,
    )

    const unob = await sftpWorkspaceIn('Lowercase Foods', 'UNOB', '/upload/unob')

    const { queue, runId } = await receiveInvoice(
      invoiceDescribing('Rudi Ruessel', 'Ruessel von Rudi'),
      inMemoryRunQueue(),
      unob,
    )

    await processQueued(queue)

    const run = await readRun(connection.db, runId)
    const reference = String(run?.controlReference)

    expect(run).toMatchObject({ status: 'delivered' })
    expect(run?.output).toMatch(/^UNA:\+\.\? 'UNB\+UNOB:3\+4389876511114:14\+.*:::Rudi Ruessel'/)
    await expect(remoteFile(`/upload/unob/INVOIC-${reference}.edi`)).resolves.toBe(run?.output)
  })

  it('marks the Interchange to a Trading Partner in Test Mode with the test indicator', async () => {
    await sftp.exec(
      `mkdir ${sftp.home}/upload/testing && chown ${sftp.username} ${sftp.home}/upload/testing`,
    )

    const testing = await sftpWorkspaceIn('Testing Foods', 'UNOC', '/upload/testing')

    await connection.db
      .update(tradingPartners)
      .set({ testMode: true })
      .where(eq(tradingPartners.id, testing.tradingPartnerId))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), testing)

    await processQueued(queue)

    const run = await readRun(connection.db, runId)
    const reference = String(run?.controlReference)

    expect(run).toMatchObject({ status: 'delivered' })
    expect(run?.output).toMatch(/^UNB\+UNOC:3\+4389876511114:14\+4071615111111:14\+/)
    expect(run?.output).toContain(`+${reference}++++++1'UNH+`)
    await expect(remoteFile(`/upload/testing/INVOIC-${reference}.edi`)).resolves.toBe(run?.output)
  })

  it.each([
    ['UNOC', 'a code point above U+00FF', ['Rudi Rüssel €', 'Rüssel von Rudi'], 13],
    ['UNOA', 'a lower-case letter', ['Rudi Rüssel', 'Rüssel von Rudi'], 2],
  ] as const)(
    'fails a Run at validation when its Message leaves %s with %s',
    async (characterSet, _character, descriptions, character) => {
      const outside = await sftpWorkspaceIn(`Outside ${characterSet} Foods`, characterSet)

      const { queue, runId } = await receiveInvoice(
        invoiceDescribing(...descriptions),
        inMemoryRunQueue(),
        outside,
      )

      await processQueued(queue)

      const run = await readRun(connection.db, runId)

      expect(run).toMatchObject({
        status: 'failed',
        failureStage: 'validation',
        output: null,
        controlReference: null,
        error: {
          code: 'invalid-character',
          position: { segment: 17, tag: 'IMD', element: 3, component: 4 },
        },
        problem: {
          reason: 'invalidContent',
          fixTarget: {
            kind: 'mapping',
            mappingId: outside.mappingId,
            fieldPath: 'SG25/IMD+A/C273/7008',
          },
        },
        steps: [
          { stage: 'receipt', status: 'succeeded' },
          { stage: 'mapping', status: 'succeeded' },
          { stage: 'validation', status: 'failed' },
          { stage: 'delivery', status: 'skipped' },
        ],
      })
      expect(run?.error?.message).toMatch(new RegExp(`, character ${String(character)}$`))
    },
  )

  it('fails a Run at delivery when no encoder writes the character set of its Trading Partner', async () => {
    const unod = await sftpWorkspaceIn('Cyrillic Foods', 'UNOD')

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), unod)

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'characterSetUnsupported', position: null, details: null },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: {
          kind: 'tradingPartner',
          tradingPartnerId: unod.tradingPartnerId,
          name: 'Hanse Retail',
        },
      },
    })
  })

  it('delivers the valid INVOIC in its own Interchange to the HTTP Channel', async () => {
    const http = await seedInvoiceWorkspace(connection.db, 'Webshop Foods')

    await connection.db
      .update(channels)
      .set({ url: erp.url })
      .where(eq(channels.id, http.outboundChannelId))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), http)

    await processQueued(queue, deliveryByChannelType)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'delivered',
      failureStage: null,
      businessReference: '4711',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    expect(run?.output).toMatch(/^UNB\+UNOC:3\+.*UNZ\+1\+1'$/)
    expect(erp.received).toMatchObject([
      {
        method: 'POST',
        headers: { 'content-type': 'application/edifact' },
        // The test ERP reads the body as UTF-8, so it gets the Latin-1 bytes that way too.
        body: Buffer.from(run?.output ?? '', 'latin1').toString(),
      },
    ])
  })

  it('fails a Run at delivery when its SFTP Channel is unreachable and keeps its Interchange', async () => {
    const unreachable = await seedInvoiceWorkspace(connection.db, 'Unreachable Foods')

    const channelId = await deliverOverSftp(connection.db, unreachable, {
      ...sftpLogin(),
      host: '127.0.0.1',
      port: 1,
    })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), unreachable)

    await processQueued(queue)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'hostUnreachable', position: null, details: null },
      problem: {
        reason: 'unreachable',
        fixTarget: { kind: 'channel', channelId, name: 'Hanse Retail SFTP inbox' },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })
    expect(run?.output).toMatch(/^UNB\+UNOC:3\+.*UNZ\+1\+1'$/)
    expect(ranStages(run)).toEqual(['receipt', 'mapping', 'validation', 'delivery'])
  })

  it('fails a Run at delivery when its SFTP server shows another host key, naming the Channel to fix', async () => {
    const impostor = await seedInvoiceWorkspace(connection.db, 'Impostor Foods')

    const channelId = await deliverOverSftp(connection.db, impostor, {
      ...sftpLogin(),
      hostKeyFingerprint: mismatchingHostKeyFingerprint,
    })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), impostor)

    await processQueued(queue)

    expect(await readRun(connection.db, runId)).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'hostKeyMismatch', position: null, details: null },
      problem: {
        reason: 'hostKeyMismatch',
        fixTarget: { kind: 'channel', channelId, name: 'Hanse Retail SFTP inbox' },
      },
    })
  })

  it('delivers a Run over an SFTP server that shows the confirmed host key', async () => {
    const confirmed = await seedInvoiceWorkspace(connection.db, 'Confirmed Foods')
    const remotePath = '/upload/confirmed'

    // Its own folder, since an INVOIC of another Workspace may already hold the file name.
    await sftp.exec(`install -d -m 777 ${sftp.home}${remotePath}`)
    await deliverOverSftp(connection.db, confirmed, {
      ...sftpLogin(),
      remotePath,
      hostKeyFingerprint: sftp.hostKeyFingerprint,
    })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), confirmed)

    await processQueued(queue)

    expect(await readRun(connection.db, runId)).toMatchObject({ status: 'delivered' })
  })

  it('fails a Run at delivery over a seeded Channel without opening a connection', async () => {
    const demo = await seedInvoiceWorkspace(connection.db, 'Demo Foods')
    const channelId = await deliverOverSftp(connection.db, demo, sftpLogin())

    await markSeeded(connection.db, channelId)

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), demo)
    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await processQueued(queue, handOvers)

    expect(handOvers).not.toHaveBeenCalled()
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      handedOverAt: null,
      error: {
        code: 'seededChannel',
        message: 'A seeded Channel never sends, so the Document never left EDI Bridge',
        position: null,
        details: null,
      },
      problem: {
        reason: 'unreachable',
        fixTarget: { kind: 'channel', channelId, name: 'Hanse Retail SFTP inbox' },
      },
    })
  })

  it('never opens a connection over a seeded Channel in the Channel adapter', async () => {
    const demo = await seedInvoiceWorkspace(connection.db, 'Adapter Demo Foods')
    const channelId = await deliverOverSftp(connection.db, demo, sftpLogin())

    const channel = await markSeeded(connection.db, channelId)

    const exit = await Effect.runPromiseExit(
      deliveryByChannelType(channel, { name: 'demo.edi', content: Buffer.from('UNA') }),
    )

    assert(Exit.isFailure(exit), 'The seeded Channel delivered')
    expect(Cause.squash(exit.cause)).toEqual(new Error(`Seeded Channel ${channelId} never sends`))
  })

  it('fails the new Run of a Reprocess at delivery when its Document came over a seeded Channel', async () => {
    const seeded = await seedInvoiceWorkspace(connection.db, 'Seeded Reprocess Foods')
    const channelId = await deliverOverSftp(connection.db, seeded, sftpLogin())

    await markSeeded(connection.db, seeded.inboundChannelId)

    const unknownUnit = JSON.stringify({
      ...invoiceDocument,
      lines: invoiceDocument.lines.map((line) => ({ ...line, unit: 'KG' })),
    })

    const { queue, runId } = await receiveInvoice(unknownUnit, inMemoryRunQueue(), seeded)

    await processQueued(queue)
    await connection.db
      .update(lookupTableEntries)
      .set({ sourceCode: 'KG' })
      .where(eq(lookupTableEntries.lookupTableId, seeded.lookupTableId))

    const reprocessing = inMemoryRunQueue()

    const reprocessed = await Effect.runPromise(
      reprocessRun({
        workspaceId: seeded.id,
        runId,
        mappingVersionId: seeded.mappingVersionId,
      }).pipe(pipelineServices(connection.db, reprocessing)),
    )

    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await processQueued(reprocessing, handOvers)

    expect(handOvers).not.toHaveBeenCalled()
    await expect(readRun(connection.db, reprocessed.runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      handedOverAt: null,
      error: {
        code: 'seededChannel',
        message: 'A seeded Channel never sends, so the Document never left EDI Bridge',
      },
      problem: { reason: 'unreachable', fixTarget: { kind: 'channel', channelId } },
    })
  })

  it('fails a Run at delivery on a defect when the database fails in the delivery step', async () => {
    const exhausted = await seedInvoiceWorkspace(connection.db, 'Exhausted Foods')

    // The next control reference overflows its integer column when it is claimed.
    await connection.db
      .update(tradingPartners)
      .set({ nextControlReference: 2_147_483_647 })
      .where(eq(tradingPartners.id, exhausted.tradingPartnerId))
    await deliverOverSftp(connection.db, exhausted, sftpLogin())

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), exhausted)

    const [queued] = queue.queued

    const exit = await Effect.runPromiseExit(
      processRun(queued ?? { workspaceId: exhausted.id, runId }).pipe(
        pipelineServices(connection.db, queue, sftpDelivery),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'deliveryDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })
  })

  it('fails a Run at delivery when the Delivery dies and passes the defect on', async () => {
    const broken = new Error('The Channel row is broken')
    const { queue, runId } = await receiveInvoice()

    const [queued] = queue.queued

    const exit = await Effect.runPromiseExit(
      processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
        pipelineServices(connection.db, queue, () => Effect.die(broken)),
      ),
    )

    expect(exit).toStrictEqual(Exit.die(broken))
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'channelDefect', position: null, details: null },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: { kind: 'channelCredential', channelId, name: 'Hanse Retail SFTP inbox' },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })
  })

  it('fails a Run at delivery when the Workspace has no GLN for the Interchange', async () => {
    const withoutGln = await seedInvoiceWorkspace(connection.db, 'Unnamed Foods')

    await connection.db
      .update(workspaces)
      .set({ gln: null })
      .where(eq(workspaces.id, withoutGln.id))
    await deliverOverSftp(connection.db, withoutGln, sftpLogin())

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), withoutGln)

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      output: null,
      error: { code: 'glnMissing', position: null, details: null },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: { kind: 'workspaceGln', name: 'Unnamed Foods' },
      },
    })
  })

  it('fails a Run at delivery when the Trading Partner has no GLN for the Interchange', async () => {
    const withoutGln = await seedInvoiceWorkspace(connection.db, 'Partnerless Foods')

    await connection.db
      .update(tradingPartners)
      .set({ gln: null })
      .where(eq(tradingPartners.id, withoutGln.tradingPartnerId))
    await deliverOverSftp(connection.db, withoutGln, sftpLogin())

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), withoutGln)

    await processQueued(queue)

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      output: null,
      error: { code: 'glnMissing', position: null, details: null },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: {
          kind: 'tradingPartnerGln',
          tradingPartnerId: withoutGln.tradingPartnerId,
          name: 'Hanse Retail',
        },
      },
    })
  })

  it('fails a Run at delivery when the credential of its Channel does not open', async () => {
    const rotated = await seedInvoiceWorkspace(connection.db, 'Rotated Foods')

    const rotatedChannelId = await deliverOverSftp(
      connection.db,
      rotated,
      sftpLogin(),
      secretBox(randomBytes(secretKeyBytes)),
    )

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), rotated)

    const [queued] = queue.queued

    const exit = await Effect.runPromiseExit(
      processRun(queued ?? { workspaceId: rotated.id, runId }).pipe(
        pipelineServices(connection.db, queue, sftpDelivery),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      error: { code: 'channelDefect', position: null, details: null },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: {
          kind: 'channelCredential',
          channelId: rotatedChannelId,
          name: 'Hanse Retail SFTP inbox',
        },
      },
    })
  })

  it('stops a Run with an invalid INVOIC at validation and keeps its built Message', async () => {
    const { queue, runId } = await receiveInvoice(tooLongInvoiceNumber)

    await processQueued(queue)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      mappingVersionId: workspace.mappingVersionId,
      output: null,
      businessReference: '4711',
      documentNumber: 'INV-'.repeat(10),
      error: {
        code: 'too-long-element',
        position: { segment: 2, tag: 'BGM', element: 2, component: null },
      },
      problem: {
        reason: 'invalidContent',
        fixTarget: {
          kind: 'mapping',
          mappingId: workspace.mappingId,
          name: 'Reference invoice: ERP JSON to INVOIC',
          fieldPath: 'BGM/1004',
        },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'failed' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping', 'validation'])

    const position = run?.error?.position
    assert(position)
    expect(storedSegments.parse(run?.deliveryInput)[position.segment - 1]).toMatchObject({
      tag: 'BGM',
    })
  })

  it('stops a Run whose code is missing from a Lookup Table at mapping and names the code to add', async () => {
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
      error: { code: 'noLookupMatch', position: null, details: null },
      problem: {
        reason: 'missingCode',
        fixTarget: {
          kind: 'lookupTable',
          lookupTableId: workspace.lookupTableId,
          name: 'Units',
          code: 'KG',
        },
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
      error: { code: 'invalidJson', position: null, details: null },
      problem: { reason: 'unreadable', fixTarget: null },
    })
  })

  it('fails a Run at its failed step when processing stops on a defect before the Run fails', async () => {
    const { queue, runId } = await receiveInvoice('not json')

    // The database refuses the failure of the Run after the mapping step failed.
    await connection.db.execute(sql`
      create function refuse_run_failure() returns trigger language plpgsql as $$
      begin
        if new.status = 'failed' and new.error->>'code' <> 'processingDefect' then
          raise exception 'The database refuses the failure';
        end if;
        return new;
      end $$`)
    await connection.db.execute(
      sql`create trigger refuse_run_failure before update on runs for each row execute function refuse_run_failure()`,
    )

    try {
      const [queued] = queue.queued

      const exit = await Effect.runPromiseExit(
        processRun(queued ?? { workspaceId: workspace.id, runId }).pipe(
          pipelineServices(connection.db, queue),
        ),
      )

      expect(Exit.hasDies(exit)).toBe(true)
    } finally {
      await connection.db.execute(sql`drop trigger refuse_run_failure on runs`)
      await connection.db.execute(sql`drop function refuse_run_failure`)
    }

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      output: null,
      error: { code: 'processingDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'mapping'])
  })

  it('fails a Run at its first unfinished stage when processing stops on a defect before it', async () => {
    const defective = await seedInvoiceWorkspace(connection.db, 'Defective Foods')

    // An outbound Flow pinned to an inbound Mapping is a defect of the stored setup.
    await connection.db
      .update(mappings)
      .set({ messageType: 'ORDERS' })
      .where(eq(mappings.id, defective.mappingId))
    await deliverOverSftp(connection.db, defective, sftpLogin())

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), defective)

    const exit = await Effect.runPromiseExit(
      processRun({ workspaceId: defective.id, runId }).pipe(
        pipelineServices(connection.db, queue, sftpDelivery),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      output: null,
      error: { code: 'processingDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
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

describe('the processing of an inbound Run', () => {
  const ordersInterchange = golden('orders-reference.edi', 'latin1')

  const ordersMessage = ordersInterchange
    .split('\n')
    .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

  const fromHanseRetail = "UNB+UNOC:3+4071615111111:14+4389876511114:14+000324:1200+00000001'"

  const interchangeOf = (messages: string[][], count = messages.length) =>
    [fromHanseRetail, ...messages.flat(), `UNZ+${count}+00000001'`].join('\n')

  const ordersWorkspace = async (name: string, options: { format?: 'json' | 'csv' } = {}) => {
    const created = await seedInvoiceWorkspace(connection.db, name)
    const orders = await addOrdersFlow(connection.db, created, { url: erp.url, ...options })

    return { ...created, orders }
  }

  const receiveInterchange = async (into: InvoiceWorkspace, content: string) => {
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content: { text: content },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    await processQueued(queue, deliveryByChannelType)

    return Promise.all(receipt.runs.map(({ id }) => readRun(connection.db, id)))
  }

  it('maps each Message of an ORDERS Interchange to the ERP Document and posts it to the HTTP Channel', async () => {
    const into = await ordersWorkspace('Order Foods')
    const document = golden('orders-reference.document.json')

    const runs = await receiveInterchange(
      into,
      interchangeOf([ordersMessage, ordersMessage, ordersMessage]),
    )

    expect(runs).toHaveLength(3)

    for (const run of runs) {
      expect(run).toMatchObject({
        status: 'delivered',
        failureStage: null,
        mappingVersionId: into.orders.mappingVersionId,
        businessReference: '128576',
        output: document,
        steps: [
          { stage: 'receipt', status: 'succeeded' },
          { stage: 'parse', status: 'succeeded' },
          { stage: 'validation', status: 'succeeded' },
          { stage: 'mapping', status: 'succeeded' },
          { stage: 'delivery', status: 'succeeded' },
        ],
      })
      expect(ranStages(run)).toEqual(['receipt', 'parse', 'validation', 'mapping', 'delivery'])
    }

    expect(erp.received).toMatchObject(
      [1, 2, 3].map(() => ({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: document,
      })),
    )
  })

  const replaced = (segment: string, by: string) =>
    ordersMessage.map((line) => (line === segment ? by : line))

  // The UNT segment count of a Message whose test added a segment.
  const counted = (message: string[]) =>
    message.map((line) =>
      line.startsWith('UNT+') ? line.replace(/^UNT\+\d+/, `UNT+${String(message.length)}`) : line,
    )

  it('gives a Run the order number of its Message as the Business Reference', async () => {
    const into = await ordersWorkspace('Order Number Foods')
    const buyer = "NAD+BY+4398765000004::9'"

    const withOrderNumber = counted(
      ordersMessage.flatMap((line) => (line === buyer ? ["RFF+ON:4500017'", buyer] : [line])),
    )

    const [run] = await receiveInterchange(into, interchangeOf([withOrderNumber]))

    expect(run).toMatchObject({ businessReference: '4500017' })
  })

  it('fails only the Run of a Message that fails mapping and delivers the others', async () => {
    const into = await ordersWorkspace('Kilogram Foods')
    const inKilograms = replaced("QTY+21:20:PCE'", "QTY+21:20:KGM'")

    const runs = await receiveInterchange(
      into,
      interchangeOf([ordersMessage, inKilograms, ordersMessage]),
    )

    expect(runs.map((run) => run?.status)).toEqual(['delivered', 'failed', 'delivered'])
    expect(runs[1]).toMatchObject({
      failureStage: 'mapping',
      output: null,
      error: { code: 'noLookupMatch', position: null, details: null },
      problem: {
        reason: 'missingCode',
        fixTarget: {
          kind: 'lookupTable',
          lookupTableId: into.orders.lookupTableId,
          name: 'Order units',
          code: 'KGM',
        },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(erp.received).toHaveLength(2)
  })

  it('points a Run whose Lookup Table no longer exists at its Mapping as an incomplete setup', async () => {
    const into = await ordersWorkspace('Tableless Foods')

    const [pinned] = await connection.db
      .select({ graph: mappingVersions.graph })
      .from(mappingVersions)
      .where(eq(mappingVersions.id, into.orders.mappingVersionId))

    if (pinned === undefined) {
      throw new Error('The ORDERS Flow has no Mapping Version')
    }

    await connection.db
      .update(mappingVersions)
      .set({
        graph: {
          ...pinned.graph,
          transforms: pinned.graph.transforms.map((transform) =>
            transform.kind === 'lookupTable'
              ? { ...transform, config: { ...transform.config, lookupTableId: randomUUID() } }
              : transform,
          ),
        },
      })
      .where(eq(mappingVersions.id, into.orders.mappingVersionId))

    const [run] = await receiveInterchange(into, ordersInterchange)

    expect(run).toMatchObject({
      failureStage: 'mapping',
      error: { code: 'unknownLookupTable' },
      problem: {
        reason: 'incompleteSetup',
        fixTarget: { kind: 'mapping', mappingId: into.orders.mappingId },
      },
    })
  })

  it('fails a broken Message at parse with its position in the Interchange', async () => {
    const into = await ordersWorkspace('Broken Foods')
    const withoutBgm = ordersMessage.filter((line) => !line.startsWith('BGM'))

    const runs = await receiveInterchange(
      into,
      interchangeOf([ordersMessage, withoutBgm, ordersMessage]),
    )

    expect(runs.map((run) => run?.status)).toEqual(['delivered', 'failed', 'delivered'])
    // UNB is segment 1, the first Message 2 to 23, so the UNT of the second one is segment 44.
    expect(runs[1]).toMatchObject({
      failureStage: 'parse',
      output: null,
      error: {
        code: 'segment-count-mismatch',
        position: { segment: 44, tag: 'UNT' },
        details: null,
      },
      problem: {
        reason: 'unreadable',
        fixTarget: {
          kind: 'tradingPartner',
          tradingPartnerId: into.tradingPartnerId,
          name: 'Hanse Retail',
        },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'mapping', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
  })

  it('fails an invalid Message at validation with its position in the Interchange', async () => {
    const into = await ordersWorkspace('Invalid Foods')
    const unknownFunction = replaced("BGM+220:::+128576+9'", "BGM+220:::+128576+99'")

    const runs = await receiveInterchange(
      into,
      interchangeOf([ordersMessage, unknownFunction, ordersMessage]),
    )

    expect(runs.map((run) => run?.status)).toEqual(['delivered', 'failed', 'delivered'])
    // The second Message starts with its UNH at segment 24, so its BGM is segment 25.
    expect(runs[1]).toMatchObject({
      failureStage: 'validation',
      output: null,
      error: { position: { segment: 25, tag: 'BGM', element: 3 }, details: null },
      problem: {
        reason: 'invalidContent',
        fixTarget: {
          kind: 'tradingPartner',
          tradingPartnerId: into.tradingPartnerId,
          name: 'Hanse Retail',
        },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'succeeded' },
        { stage: 'validation', status: 'failed' },
        { stage: 'mapping', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
  })

  it('points a validation failure in the UNZ at the UNZ of the Interchange', async () => {
    const into = await ordersWorkspace('Trailer Foods')

    const content = interchangeOf([ordersMessage, ordersMessage, ordersMessage]).replace(
      "UNZ+3+00000001'",
      "UNZ+3+00000001+\u20ac'",
    )

    const runs = await receiveInterchange(into, content)

    // UNB is segment 1 and the three Messages 2 to 67, so the UNZ is segment 68 for every Run.
    expect(runs).toMatchObject(
      [1, 2, 3].map(() => ({
        status: 'failed',
        failureStage: 'validation',
        error: { code: 'invalid-character', position: { segment: 68, tag: 'UNZ', element: 3 } },
      })),
    )
  })

  it('fails a Run at delivery when the ERP refuses the Document and keeps the Document', async () => {
    const into = await ordersWorkspace('Refused Foods')

    await connection.db
      .update(channels)
      .set({ url: `${erp.url}?status=503` })
      .where(eq(channels.id, into.orders.erpChannelId))

    const [run] = await receiveInterchange(into, ordersInterchange)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      output: golden('orders-reference.document.json'),
      error: {
        code: 'unexpectedResponse',
        position: null,
        details: { kind: 'httpResponse', status: 503 },
      },
      problem: {
        reason: 'unreachable',
        fixTarget: {
          kind: 'channel',
          channelId: into.orders.erpChannelId,
          name: 'ERP order import',
        },
      },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'delivery', status: 'failed' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'parse', 'validation', 'mapping', 'delivery'])
  })

  it('posts a CSV Document in the encoding of its Document Structure', async () => {
    const into = await ordersWorkspace('Spreadsheet Foods', { format: 'csv' })
    const document = golden('orders-reference.document.csv', 'latin1')

    const [run] = await receiveInterchange(into, ordersInterchange)

    expect(run).toMatchObject({ status: 'delivered', output: document })
    expect(erp.received).toMatchObject([
      {
        headers: { 'content-type': 'text/csv' },
        // The test ERP reads the body as UTF-8, so it gets the Windows-1252 bytes that way too.
        body: Buffer.from(document, 'latin1').toString(),
      },
    ])
  })

  it('fails a Run at mapping naming the CSV column that the encoding of its Document Structure cannot write', async () => {
    const into = await ordersWorkspace('Encoding Foods', { format: 'csv' })

    const polishContact = ordersInterchange
      .replace('UNB+UNOC:3', 'UNB+UNOD:3')
      .replace("CTA+OC+Claus Fr\u00fch'", "CTA+OC+\u0141ukasz Nowak'")

    const [run] = await receiveInterchange(into, polishContact)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: { code: 'unencodableCharacter', position: null, details: null },
      problem: {
        reason: 'invalidContent',
        fixTarget: {
          kind: 'mapping',
          mappingId: into.orders.mappingId,
          name: 'Reference order: ORDERS to ERP CSV',
          fieldPath: 'rows[].Ansprechpartner',
        },
      },
    })
  })

  it('processes an inbound Run handed out twice only once', async () => {
    const into = await ordersWorkspace('Twice Foods')
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content: { text: ordersInterchange },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    const runId = receipt.runs[0]?.id ?? ''

    await processQueued(queue, deliveryByChannelType)

    const processed = await readRun(connection.db, runId)

    await processQueued(queue, deliveryByChannelType)

    await expect(readRun(connection.db, runId)).resolves.toEqual(processed)
    expect(processed?.status).toBe('delivered')
    expect(erp.received).toHaveLength(1)
  })

  it('fails an inbound Run at the running step when processing stops on a defect in it', async () => {
    const into = await ordersWorkspace('Lost Foods')
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content: { text: ordersInterchange },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    const runId = receipt.runs[0]?.id ?? ''

    // The Interchange has no ninth Message, so reading it again in the parse step dies.
    await connection.db.update(runs).set({ messageIndex: 9 }).where(eq(runs.id, runId))

    const exit = await Effect.runPromiseExit(
      processRun({ workspaceId: into.id, runId }).pipe(
        pipelineServices(connection.db, queue, deliveryByChannelType),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)

    const run = await readRun(connection.db, runId)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'parse',
      output: null,
      error: { code: 'processingDefect', position: null, details: null },
      problem: { reason: 'defect', fixTarget: null },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'mapping', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
    expect(ranStages(run)).toEqual(['receipt', 'parse'])
    expect(erp.received).toHaveLength(0)
  })

  describe('an Interchange received again', () => {
    const fromSender = (sender: string, messages: string[][]) =>
      interchangeOf(messages).replace('4071615111111', sender)

    const receiveAgain = async (into: InvoiceWorkspace, content: string) => {
      const queue = inMemoryRunQueue()

      const receipt = await Effect.runPromise(
        receive({
          workspaceId: into.id,
          channelId: into.inboundChannelId,
          fileName: 'orders.edi',
          content: { text: content },
          manualSubmission: false,
        }).pipe(pipelineServices(connection.db, queue)),
      )

      await processQueued(queue, deliveryByChannelType)

      return {
        queued: queue.queued,
        document: receipt.document,
        runs: await Promise.all(receipt.runs.map(({ id }) => readRun(connection.db, id))),
      }
    }

    it('is recorded as a Duplicate linked to the original Run of each Message and never delivered', async () => {
      const into = await ordersWorkspace('Duplicate Foods')
      const content = interchangeOf([ordersMessage, ordersMessage])
      const originals = await receiveInterchange(into, content)
      const delivered = erp.received.length

      const again = await receiveAgain(into, content)

      expect(originals).toMatchObject([{ status: 'delivered' }, { status: 'delivered' }])
      expect(again.queued).toEqual([])
      expect(erp.received).toHaveLength(delivered)
      expect(again.document).toMatchObject({
        interchangeSender: '4071615111111',
        interchangeControlReference: '00000001',
      })
      expect(again.runs).toMatchObject(
        originals.map((original) => ({
          status: 'duplicate',
          messageIndex: original?.messageIndex,
          duplicateOfRunId: original?.id,
          failureStage: null,
          steps: [
            { stage: 'receipt', status: 'succeeded' },
            ...['parse', 'validation', 'mapping', 'delivery'].map((stage) => ({
              stage,
              status: 'skipped',
              startedAt: null,
              finishedAt: null,
            })),
          ],
        })),
      )
    })

    it('links a third copy to the original Run, not to the Duplicate', async () => {
      const into = await ordersWorkspace('Thrice Sent Foods')
      const content = interchangeOf([ordersMessage])
      const [original] = await receiveInterchange(into, content)

      await receiveAgain(into, content)
      const third = await receiveAgain(into, content)

      expect(third.runs).toMatchObject([{ status: 'duplicate', duplicateOfRunId: original?.id }])
    })

    it('is no Duplicate when another sender used the same control reference', async () => {
      const into = await ordersWorkspace('Two Sender Foods')

      await receiveInterchange(into, interchangeOf([ordersMessage]))

      const other = await receiveAgain(
        into,
        fromSender(withCheckDigit('430000000011'), [ordersMessage]),
      )

      expect(other.runs).toMatchObject([{ status: 'delivered', duplicateOfRunId: null }])
    })

    it('is no Duplicate of an Interchange another Workspace received', async () => {
      const content = interchangeOf([ordersMessage])

      await receiveInterchange(await ordersWorkspace('First Workspace Foods'), content)
      const elsewhere = await receiveAgain(await ordersWorkspace('Second Workspace Foods'), content)

      expect(elsewhere.runs).toMatchObject([{ status: 'delivered', duplicateOfRunId: null }])
    })

    it('is a Duplicate by its Interchange key when its body does not parse', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Unreadable Body Foods')
      const content = `${fromHanseRetail}\nUNH+1+ORDERS:D:96A:UN:EAN008\nUNZ+1+00000001'`

      const original = await receiveAgain(into, content)
      const again = await receiveAgain(into, content)

      expect(original.runs).toMatchObject([{ messageIndex: null, duplicateOfRunId: null }])
      expect(again.runs).toMatchObject([
        { status: 'duplicate', messageIndex: null, duplicateOfRunId: original.runs[0]?.id },
      ])
    })

    it('is no Duplicate once the Document of the original expired', async () => {
      const into = await ordersWorkspace('Long Ago Foods')
      const content = interchangeOf([ordersMessage])
      const [original] = await receiveInterchange(into, content)
      const receivedAt = original?.document?.receivedAt

      assert.instanceOf(receivedAt, Date)
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(receivedAt.getTime() + Duration.toMillis(Duration.days(90)))
          yield* deleteExpiredDocuments
        }).pipe(
          pipelineServices(connection.db, inMemoryRunQueue()),
          Effect.provide(TestClock.layer()),
        ),
      )

      const again = await receiveAgain(into, content)

      expect(again.runs).toMatchObject([{ status: 'delivered', duplicateOfRunId: null }])
    })

    it('yields one original when copies arrive at once', async () => {
      const into = await ordersWorkspace('Concurrent Foods')
      const content = interchangeOf([ordersMessage])

      const copies = await Promise.all(Array.from({ length: 4 }, () => receiveAgain(into, content)))

      const statuses = copies.flatMap(({ runs: copyRuns }) => copyRuns.map((run) => run?.status))

      expect(statuses.toSorted()).toEqual(['delivered', 'duplicate', 'duplicate', 'duplicate'])
    })
  })

  describe('an SFTP file received again', () => {
    const onSftp = async (into: InvoiceWorkspace, flowId: string) =>
      receiveOverSftp(connection.db, into, sftpLogin(), { flowId })

    const receiveFile = async (
      into: InvoiceWorkspace,
      onChannel: string,
      { fileName = 'invoice.json', content = goldenInvoice, manualSubmission = false } = {},
    ) => {
      const queue = inMemoryRunQueue()

      const receipt = await Effect.runPromise(
        receive({
          workspaceId: into.id,
          channelId: onChannel,
          fileName,
          content: { text: content },
          manualSubmission,
        }).pipe(pipelineServices(connection.db, queue)),
      )

      return {
        queued: queue.queued,
        document: receipt.document,
        runs: await Promise.all(receipt.runs.map(({ id }) => readRun(connection.db, id))),
      }
    }

    it('is recorded as a Duplicate of the original Run and never queued', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'File Again Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      const original = await receiveFile(into, sftpChannelId)
      const again = await receiveFile(into, sftpChannelId)

      expect(original.runs).toMatchObject([{ status: 'received', duplicateOfRunId: null }])
      expect(again.queued).toEqual([])
      expect(again.document).toMatchObject({
        channelId: sftpChannelId,
        fileName: 'invoice.json',
        contentHash: contentHashOf(goldenInvoice),
      })
      expect(again.runs).toMatchObject([
        {
          status: 'duplicate',
          messageIndex: null,
          duplicateOfRunId: original.runs[0]?.id,
          steps: [
            { stage: 'receipt', status: 'succeeded' },
            ...['mapping', 'validation', 'delivery'].map((stage) => ({ stage, status: 'skipped' })),
          ],
        },
      ])
    })

    it('links a third copy to the original Run, not to the Duplicate', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'File Thrice Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      const original = await receiveFile(into, sftpChannelId)

      await receiveFile(into, sftpChannelId)
      const third = await receiveFile(into, sftpChannelId)

      expect(third.runs).toMatchObject([
        { status: 'duplicate', duplicateOfRunId: original.runs[0]?.id },
      ])
    })

    it('is no Duplicate under another file name', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Renamed File Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      await receiveFile(into, sftpChannelId)
      const renamed = await receiveFile(into, sftpChannelId, { fileName: 'invoice-2.json' })

      expect(renamed.runs).toMatchObject([{ status: 'received', duplicateOfRunId: null }])
    })

    it('is no Duplicate with other content under the same file name', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Changed File Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      await receiveFile(into, sftpChannelId)
      const changed = await receiveFile(into, sftpChannelId, { content: `${goldenInvoice}\n` })

      expect(changed.runs).toMatchObject([{ status: 'received', duplicateOfRunId: null }])
    })

    it('is no Duplicate of a file another SFTP Channel received', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Two Outbox Foods')
      const firstChannelId = await onSftp(into, into.flowId)

      await receiveFile(into, firstChannelId)
      const secondChannelId = await onSftp(into, into.flowId)
      const elsewhere = await receiveFile(into, secondChannelId)

      expect(elsewhere.runs).toMatchObject([{ status: 'received', duplicateOfRunId: null }])
    })

    it('keeps processing a Manual Submission of the same file', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Submitted File Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      await receiveFile(into, sftpChannelId)
      const submitted = await receiveFile(into, sftpChannelId, { manualSubmission: true })
      const resubmitted = await receiveFile(into, sftpChannelId, { manualSubmission: true })

      expect(submitted.document.contentHash).toBeNull()
      expect([...submitted.runs, ...resubmitted.runs]).toMatchObject([
        { status: 'received', duplicateOfRunId: null },
        { status: 'received', duplicateOfRunId: null },
      ])
    })

    it('keeps processing the same request on a webhook Channel', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Webhook Foods')

      const first = await receiveFile(into, into.inboundChannelId)
      const second = await receiveFile(into, into.inboundChannelId)

      expect(second.document.contentHash).toBeNull()
      expect([...first.runs, ...second.runs]).toMatchObject([
        { status: 'received', duplicateOfRunId: null },
        { status: 'received', duplicateOfRunId: null },
      ])
    })

    it('yields one original when copies arrive at once', async () => {
      const into = await seedInvoiceWorkspace(connection.db, 'Concurrent File Foods')
      const sftpChannelId = await onSftp(into, into.flowId)

      const copies = await Promise.all(
        Array.from({ length: 4 }, () => receiveFile(into, sftpChannelId)),
      )

      const statuses = copies.flatMap(({ runs: copyRuns }) => copyRuns.map((run) => run?.status))

      expect(statuses.toSorted()).toEqual(['duplicate', 'duplicate', 'duplicate', 'received'])
    })

    it('is a Duplicate of the original Interchange when either key matches', async () => {
      const into = await ordersWorkspace('Either Key Foods')
      const sftpChannelId = await onSftp(into, into.orders.flowId)
      const content = interchangeOf([ordersMessage, ordersMessage])
      const asOrders = { fileName: 'orders.edi', content }

      const original = await receiveFile(into, sftpChannelId, asOrders)
      const renamed = await receiveFile(into, sftpChannelId, { ...asOrders, fileName: 'copy.edi' })

      // The file key matches only the Duplicate above, so the Interchange key finds the original.
      const renamedAgain = await receiveFile(into, sftpChannelId, {
        ...asOrders,
        fileName: 'copy.edi',
      })

      const originalIds = original.runs.map((run) => run?.id)

      expect(original.runs).toMatchObject([{ status: 'received' }, { status: 'received' }])

      for (const copy of [renamed, renamedAgain]) {
        expect(copy.runs.map((run) => run?.duplicateOfRunId)).toEqual(originalIds)
      }
    })
  })

  describe('a delivered resend', () => {
    let sent = 0

    // A Trading Partner sends a corrected copy as a new Interchange, so each copy gets a control reference of its own.
    const sentAnew = (content: string) => {
      sent += 1

      return content.replaceAll("+00000001'", `+${String(100 + sent).padStart(8, '0')}'`)
    }

    const invalidOrders = (order: string) =>
      sentAnew(interchangeOf([replaced("BGM+220:::+128576+9'", `BGM+220:::+${order}+99'`)]))

    const validOrders = (order: string) =>
      sentAnew(interchangeOf([replaced("BGM+220:::+128576+9'", `BGM+220:::+${order}+9'`)]))

    const idOf = (run: { id: string } | undefined) => {
      if (run === undefined) {
        throw new Error('The Interchange created no Run')
      }

      return run.id
    }

    const markWaiting = (runId: string) =>
      connection.db
        .update(runs)
        .set({ waitingForTradingPartnerSince: new Date() })
        .where(eq(runs.id, runId))

    it('replaces the newest waiting Run of its Flow with its document number and ends the mark', async () => {
      const into = await ordersWorkspace('Resend Foods')
      const older = idOf((await receiveInterchange(into, invalidOrders('128576')))[0])
      const [newer] = await receiveInterchange(into, invalidOrders('128576'))
      const newerId = idOf(newer)

      await markWaiting(newerId)

      const [resend] = await receiveInterchange(into, validOrders('128576'))

      expect(newer).toMatchObject({ status: 'failed', businessReference: '128576' })
      expect(resend).toMatchObject({ status: 'delivered', replacesRunId: newerId })
      await expect(readRun(connection.db, newerId)).resolves.toMatchObject({
        status: 'failed',
        waitingForTradingPartnerSince: null,
      })
      await expect(readRun(connection.db, older)).resolves.toMatchObject({
        status: 'failed',
        replacesRunId: null,
      })
    })

    it('publishes the waiting Run it replaces', async () => {
      const into = await ordersWorkspace('Announced Resend Foods')
      const waitingId = idOf((await receiveInterchange(into, invalidOrders('128577')))[0])

      await markWaiting(waitingId)
      await receiveInterchange(into, validOrders('128577'))

      expect(liveStatusesOf(waitingId)).toEqual(['received', 'processing', 'failed', 'failed'])
    })

    it('replaces a waiting Run once, so the next resend replaces the Run before it', async () => {
      const into = await ordersWorkspace('Twice Sent Foods')
      const older = idOf((await receiveInterchange(into, invalidOrders('128576')))[0])
      const newer = idOf((await receiveInterchange(into, invalidOrders('128576')))[0])

      const [first] = await receiveInterchange(into, validOrders('128576'))
      const [second] = await receiveInterchange(into, validOrders('128576'))

      expect(first).toMatchObject({ replacesRunId: newer })
      expect(second).toMatchObject({ replacesRunId: older })
    })

    // An order number in RFF+ON makes it the Business Reference, so each Message of the order shares it.
    const ofOrder = (order: string, documentNumber: string, messageFunction: string) => {
      const buyer = "NAD+BY+4398765000004::9'"

      const changed = new Map([
        ["BGM+220:::+128576+9'", [`BGM+220:::+${documentNumber}+${messageFunction}'`]],
        [buyer, [`RFF+ON:${order}'`, buyer]],
      ])

      return sentAnew(
        interchangeOf([counted(ordersMessage.flatMap((line) => changed.get(line) ?? [line]))]),
      )
    }

    it('replaces the waiting Run of its document number, not another Message of its order', async () => {
      const into = await ordersWorkspace('Document Number Foods')
      const waiting = idOf((await receiveInterchange(into, ofOrder('4500017', '128576', '99')))[0])

      await markWaiting(waiting)

      const [other] = await receiveInterchange(into, ofOrder('4500017', '128577', '9'))

      expect(other).toMatchObject({
        status: 'delivered',
        businessReference: '4500017',
        documentNumber: '128577',
        replacesRunId: null,
      })
      await expect(readRun(connection.db, waiting)).resolves.not.toMatchObject({
        waitingForTradingPartnerSince: null,
      })

      const [resend] = await receiveInterchange(into, ofOrder('4500017', '128576', '9'))

      expect(resend).toMatchObject({ status: 'delivered', replacesRunId: waiting })
      await expect(readRun(connection.db, waiting)).resolves.toMatchObject({
        businessReference: '4500017',
        documentNumber: '128576',
        waitingForTradingPartnerSince: null,
      })
    })

    it('leaves a waiting Run of another document number or without one', async () => {
      const into = await ordersWorkspace('Other Order Foods')
      const other = idOf((await receiveInterchange(into, invalidOrders('900001')))[0])

      const unreadable = idOf(
        (
          await receiveInterchange(
            into,
            interchangeOf([ordersMessage.filter((line) => !line.startsWith('BGM'))]),
          )
        )[0],
      )

      await markWaiting(other)
      await markWaiting(unreadable)

      const [resend] = await receiveInterchange(into, validOrders('128576'))

      expect(resend).toMatchObject({ status: 'delivered', replacesRunId: null })

      const [stillOther, stillUnreadable] = await Promise.all([
        readRun(connection.db, other),
        readRun(connection.db, unreadable),
      ])

      expect(stillOther?.businessReference).toBe('900001')
      expect(stillOther?.waitingForTradingPartnerSince).not.toBeNull()
      expect(stillUnreadable?.businessReference).toBeNull()
      expect(stillUnreadable?.waitingForTradingPartnerSince).not.toBeNull()
    })

    it('leaves a waiting Run of another Flow', async () => {
      const into = await ordersWorkspace('Two Flow Foods')
      const waiting = idOf((await receiveInterchange(into, invalidOrders('128576')))[0])
      const elsewhere = await ordersWorkspace('Elsewhere Foods')

      const [resend] = await receiveInterchange(elsewhere, validOrders('128576'))

      expect(resend).toMatchObject({ status: 'delivered', replacesRunId: null })
      await expect(readRun(connection.db, waiting)).resolves.toMatchObject({
        status: 'failed',
      })
    })

    it('stays delivered when the replace of the waiting Run fails', async () => {
      const into = await ordersWorkspace('Unlinked Foods')
      const waiting = idOf((await receiveInterchange(into, invalidOrders('128576')))[0])
      await markWaiting(waiting)
      const received = erp.received.length

      await connection.db.execute(sql`
        create function refuse_replace() returns trigger language plpgsql as $$
        begin
          raise exception 'replace refused';
        end $$
      `)
      await connection.db.execute(sql`
        create trigger refuse_replace before update of replaces_run_id on runs
        for each row when (new.workspace_id = ${sql.raw(`'${into.id}'`)})
        execute function refuse_replace()
      `)

      try {
        const [resend] = await receiveInterchange(into, validOrders('128576'))

        expect(resend).toMatchObject({ status: 'delivered', replacesRunId: null })
        expect(erp.received).toHaveLength(received + 1)
        await expect(readRun(connection.db, waiting)).resolves.not.toMatchObject({
          waitingForTradingPartnerSince: null,
        })
      } finally {
        await connection.db.execute(sql`drop trigger refuse_replace on runs`)
        await connection.db.execute(sql`drop function refuse_replace()`)
      }
    })
  })
})

describe('the Retry of a Run', () => {
  const retried = async (into: InvoiceWorkspace, runId: string, delivery = sftpDelivery) => {
    const queue = inMemoryRunQueue()

    await Effect.runPromise(
      retryRun({ workspaceId: into.id, runId }).pipe(pipelineServices(connection.db, queue)),
    )

    expect(queue.queued).toEqual([{ workspaceId: into.id, runId }])

    await processQueued(queue, delivery)

    return readRun(connection.db, runId)
  }

  // Each Trading Partner counts its control references from 1, so each gets its own remote path.
  const outboxOf = async (name: string) => {
    const remotePath = `/upload/${name}`

    await sftp.exec(
      `mkdir ${sftp.home}${remotePath} && chown ${sftp.username} ${sftp.home}${remotePath}`,
    )

    return { ...sftpLogin(), remotePath }
  }

  it('fails the Retry of a seeded Run at delivery again after its Flow names a Channel that is not seeded', async () => {
    const seeded = await seedInvoiceWorkspace(connection.db, 'Seeded Retry Foods')

    await markSeeded(connection.db, seeded.inboundChannelId)
    await markSeeded(connection.db, await deliverOverSftp(connection.db, seeded, sftpLogin()))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), seeded)

    await processQueued(queue)

    const channelId = await deliverOverSftp(connection.db, seeded, await outboxOf('seeded-retry'))
    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await expect(retried(seeded, runId, handOvers)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      handedOverAt: null,
      error: {
        code: 'seededChannel',
        message: 'A seeded Channel never sends, so the Document never left EDI Bridge',
      },
      problem: { reason: 'unreachable', fixTarget: { kind: 'channel', channelId } },
    })
    expect(handOvers).not.toHaveBeenCalled()
  })

  it('fails the Retry of a seeded Run at delivery after its retention period and a Flow repointed to a Channel that is not seeded', async () => {
    const seeded = await seedInvoiceWorkspace(connection.db, 'Seeded Expired Retry Foods')

    await markSeeded(connection.db, seeded.inboundChannelId)
    await markSeeded(connection.db, await deliverOverSftp(connection.db, seeded, sftpLogin()))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), seeded)

    await processQueued(queue)

    const receivedAt = (await readRun(connection.db, runId))?.document?.receivedAt

    assert.instanceOf(receivedAt, Date)
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(receivedAt.getTime() + Duration.toMillis(Duration.days(90)))
        yield* deleteExpiredDocuments
      }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
        Effect.provide(TestClock.layer()),
      ),
    )

    const channelId = await deliverOverSftp(
      connection.db,
      seeded,
      await outboxOf('seeded-expired-retry'),
    )

    const handOvers = vi.fn<DeliveryService>(() => Effect.void)

    await expect(retried(seeded, runId, handOvers)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      handedOverAt: null,
      error: { code: 'seededChannel' },
      problem: { reason: 'unreachable', fixTarget: { kind: 'channel', channelId } },
    })
    expect(handOvers).not.toHaveBeenCalled()
  })

  it('delivers the stored Interchange again under its control reference once the SFTP Channel is reachable', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Flaky Foods')
    const login = await outboxOf('flaky')
    const flakyChannelId = await deliverOverSftp(connection.db, into, { ...login, port: 1 })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)

    await connection.db
      .update(channels)
      .set({ port: sftp.port })
      .where(eq(channels.id, flakyChannelId))

    const run = await retried(into, runId)

    expect(run).toMatchObject({
      status: 'delivered',
      failureStage: null,
      error: null,
      problem: null,
      output: failed?.output,
      controlReference: failed?.controlReference,
      mappingVersionId: into.mappingVersionId,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded', finishedAt: failed?.steps[1]?.finishedAt },
        { stage: 'validation', status: 'succeeded', finishedAt: failed?.steps[2]?.finishedAt },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    await expect(
      remoteFile(`${login.remotePath}/INVOIC-${String(failed?.controlReference)}.edi`),
    ).resolves.toBe(failed?.output)
  })

  it('counts an Interchange that landed at the failed attempt as delivered and keeps it', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Landed Foods')
    const login = await outboxOf('landed')
    const landedChannelId = await deliverOverSftp(connection.db, into, { ...login, port: 1 })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)
    const name = `${login.remotePath}/INVOIC-${String(failed?.controlReference)}.edi`

    // The Channel took the file but the attempt timed out before it answered.
    await sftp.exec(`echo landed > ${sftp.home}${name}`)
    await connection.db
      .update(channels)
      .set({ port: sftp.port })
      .where(eq(channels.id, landedChannelId))

    const run = await retried(into, runId)

    expect(run).toMatchObject({ status: 'delivered', output: failed?.output })
    await expect(remoteFile(name)).resolves.toBe('landed\n')
  })

  it('builds the Interchange of a Run that failed for a missing GLN from its stored Message without mapping again', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Late Foods')

    await connection.db.update(workspaces).set({ gln: null }).where(eq(workspaces.id, into.id))
    await deliverOverSftp(connection.db, into, await outboxOf('late'))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)

    expect(failed).toMatchObject({ failureStage: 'delivery', output: null })

    // Mapping again would miss the unit code, so only the stored Message can deliver the Run.
    await connection.db
      .delete(lookupTableEntries)
      .where(eq(lookupTableEntries.lookupTableId, into.lookupTableId))
    await connection.db
      .update(workspaces)
      .set({ gln: '4012345000009' })
      .where(eq(workspaces.id, into.id))

    const run = await retried(into, runId)
    const reference = String(run?.controlReference)

    expect(run).toMatchObject({
      status: 'delivered',
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded', finishedAt: failed?.steps[1]?.finishedAt },
        { stage: 'validation', status: 'succeeded', finishedAt: failed?.steps[2]?.finishedAt },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    expect(run?.output).toMatch(
      new RegExp(`^UNB\\+UNOC:3\\+4012345000009:14\\+\\d{13}:14\\+[^+]+\\+${reference}'`),
    )
    expect(run?.output).toContain(invoicSegments)
    await expect(remoteFile(`/upload/late/INVOIC-${reference}.edi`)).resolves.toBe(run?.output)
  })

  it('envelopes a Run that failed for its character set in the character set its Trading Partner has now', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Recoded Foods')

    await connection.db
      .update(tradingPartners)
      .set({ characterSet: 'UNOD' })
      .where(eq(tradingPartners.id, into.tradingPartnerId))
    await deliverOverSftp(connection.db, into, await outboxOf('recoded'))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)

    expect(failed).toMatchObject({ error: { code: 'characterSetUnsupported' }, output: null })

    await connection.db
      .update(tradingPartners)
      .set({ characterSet: 'UNOC' })
      .where(eq(tradingPartners.id, into.tradingPartnerId))

    const run = await retried(into, runId)

    expect(run).toMatchObject({ status: 'delivered', controlReference: failed?.controlReference })
    expect(run?.output).toMatch(/^UNB\+UNOC:3\+/)
    await expect(
      remoteFile(`/upload/recoded/INVOIC-${String(run?.controlReference)}.edi`),
    ).resolves.toBe(run?.output)
  })

  it('does not deliver again a Run whose delivery the Channel took before a defect failed it', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Unrecorded Foods')
    const handedOver: string[] = []

    const counting: DeliveryService = (_channel, document) =>
      Effect.sync(() => {
        handedOver.push(document.name)
      })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    // The database refuses to record the delivery after the Channel took it.
    await connection.db.execute(sql`
      create function refuse_delivered() returns trigger language plpgsql as $$
      begin
        if new.status = 'delivered' then
          raise exception 'The database refuses the delivery';
        end if;
        return new;
      end $$`)
    await connection.db.execute(
      sql`create trigger refuse_delivered before update on runs for each row execute function refuse_delivered()`,
    )

    try {
      const [queued] = queue.queued

      const exit = await Effect.runPromiseExit(
        processRun(queued ?? { workspaceId: into.id, runId }).pipe(
          pipelineServices(connection.db, queue, counting),
        ),
      )

      expect(Exit.hasDies(exit)).toBe(true)
    } finally {
      await connection.db.execute(sql`drop trigger refuse_delivered on runs`)
      await connection.db.execute(sql`drop function refuse_delivered`)
    }

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      problem: { reason: 'defect' },
    })

    const run = await retried(into, runId, counting)

    expect(run).toMatchObject({ status: 'delivered' })
    expect(handedOver).toEqual([`INVOIC-${String(run?.controlReference)}.edi`])
  })

  it('refuses a Run that did not fail at delivery and leaves it as it is', async () => {
    const { queue, runId } = await receiveInvoice('not json')

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)
    const retrying = inMemoryRunQueue()

    const error = await Effect.runPromise(
      Effect.flip(
        retryRun({ workspaceId: workspace.id, runId }).pipe(
          pipelineServices(connection.db, retrying),
        ),
      ),
    )

    expect(error).toEqual(new RunNotRetryable({ runId }))
    expect(retrying.queued).toEqual([])
    await expect(readRun(connection.db, runId)).resolves.toEqual(failed)
  })

  it('refuses a Run that failed at validation although it kept its built Message', async () => {
    const { queue, runId } = await receiveInvoice(tooLongInvoiceNumber)

    await processQueued(queue)

    const failed = await readRun(connection.db, runId)
    const retrying = inMemoryRunQueue()

    const error = await Effect.runPromise(
      Effect.flip(
        retryRun({ workspaceId: workspace.id, runId }).pipe(
          pipelineServices(connection.db, retrying),
        ),
      ),
    )

    const storedDeliveryInput: unknown = expect.anything()

    expect(failed).toMatchObject({ failureStage: 'validation', deliveryInput: storedDeliveryInput })
    expect(error).toEqual(new RunNotRetryable({ runId }))
    expect(retrying.queued).toEqual([])
    await expect(readRun(connection.db, runId)).resolves.toEqual(failed)
  })

  it('refuses a Run that failed at delivery with neither a stored output nor a stored delivery input', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Early Foods')

    await connection.db.update(workspaces).set({ gln: null }).where(eq(workspaces.id, into.id))
    await deliverOverSftp(connection.db, into, await outboxOf('early'))

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue)

    // A Run that failed at delivery before the delivery input was stored has neither.
    await connection.db.update(runs).set({ deliveryInput: null }).where(eq(runs.id, runId))

    const failed = await readRun(connection.db, runId)
    const retrying = inMemoryRunQueue()

    const error = await Effect.runPromise(
      Effect.flip(
        retryRun({ workspaceId: into.id, runId }).pipe(pipelineServices(connection.db, retrying)),
      ),
    )

    expect(failed).toMatchObject({ failureStage: 'delivery', output: null })
    expect(error).toEqual(new RunNotRetryable({ runId }))
    expect(retrying.queued).toEqual([])
    await expect(readRun(connection.db, runId)).resolves.toEqual(failed)
  })

  it('refuses a Run of another Workspace', async () => {
    const other = await seedInvoiceWorkspace(connection.db, 'Neighbour Foods')
    const login = await outboxOf('neighbour')

    await deliverOverSftp(connection.db, other, { ...login, port: 1 })

    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), other)

    await processQueued(queue)

    const error = await Effect.runPromise(
      Effect.flip(
        retryRun({ workspaceId: workspace.id, runId }).pipe(
          pipelineServices(connection.db, inMemoryRunQueue()),
        ),
      ),
    )

    expect(error).toEqual(new RunNotRetryable({ runId }))
    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'failed' })
  })

  it('posts the stored Document of an inbound Run again once the ERP takes it', async () => {
    const into = await seedInvoiceWorkspace(connection.db, 'Recovered Foods')
    const orders = await addOrdersFlow(connection.db, into, { url: `${erp.url}?status=503` })
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content: { text: golden('orders-reference.edi', 'latin1') },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    await processQueued(queue, deliveryByChannelType)

    const runId = receipt.runs[0]?.id ?? ''

    await connection.db
      .update(channels)
      .set({ url: erp.url })
      .where(eq(channels.id, orders.erpChannelId))

    erp.received.length = 0

    const run = await retried(into, runId, deliveryByChannelType)
    const document = golden('orders-reference.document.json')

    expect(run).toMatchObject({
      status: 'delivered',
      output: document,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'parse', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    expect(erp.received).toMatchObject([
      { headers: { 'content-type': 'application/json' }, body: document },
    ])
  })
})

describe('the Acknowledgement of a sent Interchange', () => {
  const partnerGln = '4071615111111'

  const workspaceGln = '4389876511114'

  // Each CONTRL gets its own Interchange control reference, so none is a Duplicate.
  const contrlOf = (
    controlReference: string,
    action: string,
    { sender = partnerGln, messages = '' }: { sender?: string; messages?: string } = {},
  ) => {
    const own = randomUUID().slice(0, 8)
    const segments = `UCI+${controlReference}+${workspaceGln}:14+${partnerGln}:14+${action}'${messages}`
    const segmentCount = segments.split("'").length + 1

    return (
      `UNB+UNOC:3+${sender}:14+${workspaceGln}:14+261020:0800+${own}'` +
      `UNH+1+CONTRL:D:3:UN:EAN002'${segments}UNT+${String(segmentCount)}+1'UNZ+1+${own}'`
    )
  }

  const acknowledgingWorkspace = async (name: string) => {
    const into = await seedInvoiceWorkspace(connection.db, name)

    await connection.db
      .update(channels)
      .set({ url: erp.url })
      .where(eq(channels.id, into.outboundChannelId))
    await addContrlFlow(connection.db, into, { url: erp.url })

    return into
  }

  const sendInvoice = async (into: InvoiceWorkspace) => {
    const { queue, runId } = await receiveInvoice(goldenInvoice, inMemoryRunQueue(), into)

    await processQueued(queue, deliveryByChannelType)

    return readRun(connection.db, runId)
  }

  const receiveContrl = async (into: InvoiceWorkspace, content: string) => {
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'contrl.edi',
        content: { text: content },
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue)),
    )

    await processQueued(queue, deliveryByChannelType)

    return readRun(connection.db, receipt.runs[0]?.id ?? '')
  }

  it('awaits the Acknowledgement of an Interchange once the Channel took it', async () => {
    const into = await acknowledgingWorkspace('Pending Foods')

    await expect(sendInvoice(into)).resolves.toMatchObject({
      status: 'delivered',
      acknowledgementState: 'pending',
    })
  })

  it('awaits no Acknowledgement of an Interchange the Channel did not take', async () => {
    const into = await acknowledgingWorkspace('Unreachable Foods')

    await connection.db
      .update(channels)
      .set({ url: `${erp.url}?status=503` })
      .where(eq(channels.id, into.outboundChannelId))

    await expect(sendInvoice(into)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      acknowledgementState: null,
    })
  })

  it.each([
    ['accepted', 'the action 7', '7', ''],
    ['accepted', 'the action 8', '8', ''],
    ['rejected', 'the action 4', '4', ''],
    ['rejected', 'the action 6', '6', ''],
    ['rejected', 'the action 7 with a rejected Message', '7', "UCM+1+INVOIC:D:96A:UN:EAN008+4'"],
  ])(
    'marks the sent Interchange %s by a CONTRL with %s and delivers the CONTRL',
    async (status, _case, action, messages) => {
      const into = await acknowledgingWorkspace(`Acknowledged Foods ${action} ${messages}`)
      const sent = await sendInvoice(into)

      const contrl = await receiveContrl(
        into,
        contrlOf(String(sent?.controlReference), action, { messages }),
      )

      expect(contrl).toMatchObject({ status: 'delivered', acknowledgementState: null })
      await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
        status: 'delivered',
        acknowledgementState: status,
      })
    },
  )

  it('accepts an overdue Interchange by a late CONTRL', async () => {
    const into = await acknowledgingWorkspace('Late Foods')
    const sent = await sendInvoice(into)

    await connection.db
      .update(runs)
      .set({ acknowledgementState: 'overdue' })
      .where(eq(runs.id, sent?.id ?? ''))

    await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

    await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'accepted',
    })
  })

  it('publishes an Interchange its CONTRL acknowledged', async () => {
    const into = await acknowledgingWorkspace('Announced Foods')
    const sent = await sendInvoice(into)
    const before = liveStatusesOf(sent?.id ?? '').length

    await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

    expect(liveStatusesOf(sent?.id ?? '').slice(before)).toEqual(['delivered'])
  })

  it('accepts an Interchange by a CONTRL with a zero-padded control reference', async () => {
    const into = await acknowledgingWorkspace('Padded Foods')
    const sent = await sendInvoice(into)

    await receiveContrl(into, contrlOf(String(sent?.controlReference).padStart(5, '0'), '7'))

    await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'accepted',
    })
  })

  it('keeps the first Acknowledgement of an Interchange', async () => {
    const into = await acknowledgingWorkspace('Settled Foods')
    const sent = await sendInvoice(into)

    await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))
    await receiveContrl(into, contrlOf(String(sent?.controlReference), '4'))

    await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'accepted',
    })
  })

  it.each([
    ['another control reference', (reference: number) => contrlOf(String(reference + 1), '7')],
    ['a control reference that is no number', () => contrlOf('CTL1', '7')],
    [
      'another sender',
      (reference: number) => contrlOf(String(reference), '7', { sender: '4012345000016' }),
    ],
  ])('changes nothing for a CONTRL of %s and delivers it', async (_case, contrlFor) => {
    const into = await acknowledgingWorkspace(`Unmatched Foods ${_case}`)
    const sent = await sendInvoice(into)

    const contrl = await receiveContrl(into, contrlFor(sent?.controlReference ?? 0))

    expect(contrl).toMatchObject({ status: 'delivered' })
    await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'pending',
    })
  })

  it('matches only an Interchange of its own Workspace', async () => {
    const into = await acknowledgingWorkspace('Own Foods')
    const other = await acknowledgingWorkspace('Other Foods')
    const sent = await sendInvoice(into)
    const elsewhere = await sendInvoice(other)

    expect(elsewhere?.controlReference).toBe(sent?.controlReference)

    await receiveContrl(other, contrlOf(String(elsewhere?.controlReference), '4'))

    await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'pending',
    })
    await expect(readRun(connection.db, elsewhere?.id ?? '')).resolves.toMatchObject({
      acknowledgementState: 'rejected',
    })
  })

  describe('the onboarding of a Trading Partner in Test Mode', () => {
    const setTestMode = (into: InvoiceWorkspace, testMode: boolean) =>
      connection.db
        .update(tradingPartners)
        .set({ testMode })
        .where(eq(tradingPartners.id, into.tradingPartnerId))

    const testingWorkspace = async (name: string) => {
      const into = await acknowledgingWorkspace(name)

      await setTestMode(into, true)

      return into
    }

    const onboardingOf = async (into: InvoiceWorkspace) => {
      const [onboarding] = await connection.db
        .select({
          testInterchangeSentAt: tradingPartners.testInterchangeSentAt,
          contrlReceivedAt: tradingPartners.contrlReceivedAt,
          testRejectedAt: tradingPartners.testRejectedAt,
          testRejectedRunId: tradingPartners.testRejectedRunId,
        })
        .from(tradingPartners)
        .where(eq(tradingPartners.id, into.tradingPartnerId))

      return onboarding
    }

    it('records the handover of the first test Interchange', async () => {
      const into = await testingWorkspace('First Test Foods')
      const sent = await sendInvoice(into)

      expect(sent?.handedOverAt).toBeInstanceOf(Date)
      await expect(onboardingOf(into)).resolves.toEqual({
        testInterchangeSentAt: sent?.handedOverAt,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    it('keeps the handover of the first test Interchange', async () => {
      const into = await testingWorkspace('Second Test Foods')
      const first = await sendInvoice(into)

      await sendInvoice(into)

      await expect(onboardingOf(into)).resolves.toMatchObject({
        testInterchangeSentAt: first?.handedOverAt,
      })
    })

    it('records no test Interchange that the Channel did not take', async () => {
      const into = await testingWorkspace('Unreachable Test Foods')

      await connection.db
        .update(channels)
        .set({ url: `${erp.url}?status=503` })
        .where(eq(channels.id, into.outboundChannelId))
      await sendInvoice(into)

      await expect(onboardingOf(into)).resolves.toMatchObject({ testInterchangeSentAt: null })
    })

    it('records the receipt of the first accepting CONTRL to a test Interchange', async () => {
      const into = await testingWorkspace('Confirmed Test Foods')
      const sent = await sendInvoice(into)

      const contrl = await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

      expect(contrl?.receivedAt).toBeInstanceOf(Date)
      await expect(onboardingOf(into)).resolves.toMatchObject({
        contrlReceivedAt: contrl?.receivedAt,
      })
    })

    it('keeps the receipt of the first accepting CONTRL', async () => {
      const into = await testingWorkspace('Twice Confirmed Test Foods')
      const first = await sendInvoice(into)
      const second = await sendInvoice(into)

      const contrl = await receiveContrl(into, contrlOf(String(first?.controlReference), '7'))

      await receiveContrl(into, contrlOf(String(second?.controlReference), '7'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        contrlReceivedAt: contrl?.receivedAt,
      })
    })

    it.each([
      ['rejects the test Interchange', (reference: number) => contrlOf(String(reference), '4')],
      [
        'acknowledges another Interchange',
        (reference: number) => contrlOf(String(reference + 1), '7'),
      ],
      [
        'comes from another sender',
        (reference: number) => contrlOf(String(reference), '7', { sender: '4012345000016' }),
      ],
    ])('records no receipt of a CONTRL that %s', async (description, contrlFor) => {
      const into = await testingWorkspace(`Unconfirmed Test Foods ${description}`)
      const sent = await sendInvoice(into)

      await receiveContrl(into, contrlFor(sent?.controlReference ?? 0))

      await expect(onboardingOf(into)).resolves.toMatchObject({ contrlReceivedAt: null })
    })

    it('records no receipt of an accepting CONTRL after an earlier rejecting one', async () => {
      const into = await testingWorkspace('Rejected Test Foods')
      const sent = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(sent?.controlReference), '4'))
      await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

      await expect(onboardingOf(into)).resolves.toMatchObject({ contrlReceivedAt: null })
    })

    it('records no onboarding step once the Trading Partner is in production', async () => {
      const into = await testingWorkspace('Live Test Foods')

      await setTestMode(into, false)

      const sent = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

      await expect(onboardingOf(into)).resolves.toEqual({
        testInterchangeSentAt: null,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    it('records no receipt of a CONTRL that arrives after the switch to production', async () => {
      const into = await testingWorkspace('Switched Test Foods')
      const sent = await sendInvoice(into)

      await setTestMode(into, false)
      await receiveContrl(into, contrlOf(String(sent?.controlReference), '7'))

      await expect(onboardingOf(into)).resolves.toMatchObject({ contrlReceivedAt: null })
    })

    it('records the rejection of a test Interchange with the Run that sent it', async () => {
      const into = await testingWorkspace('Refused Test Foods')
      const sent = await sendInvoice(into)

      const contrl = await receiveContrl(into, contrlOf(String(sent?.controlReference), '4'))

      expect(contrl?.receivedAt).toBeInstanceOf(Date)
      await expect(onboardingOf(into)).resolves.toMatchObject({
        contrlReceivedAt: null,
        testRejectedAt: contrl?.receivedAt,
        testRejectedRunId: sent?.id,
      })
    })

    it('records the latest rejection of a test Interchange', async () => {
      const into = await testingWorkspace('Twice Refused Test Foods')
      const first = await sendInvoice(into)
      const second = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(first?.controlReference), '4'))

      const contrl = await receiveContrl(into, contrlOf(String(second?.controlReference), '4'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        testRejectedAt: contrl?.receivedAt,
        testRejectedRunId: second?.id,
      })
    })

    it('keeps the rejection of the latest test Interchange when an earlier one is rejected late', async () => {
      const into = await testingWorkspace('Late Refused Test Foods')
      const first = await sendInvoice(into)
      const second = await sendInvoice(into)

      const contrl = await receiveContrl(into, contrlOf(String(second?.controlReference), '4'))

      await receiveContrl(into, contrlOf(String(first?.controlReference), '4'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        testRejectedAt: contrl?.receivedAt,
        testRejectedRunId: second?.id,
      })
    })

    it('records no rejection of a test Interchange sent before the awaited one', async () => {
      const into = await testingWorkspace('Earlier Refused Test Foods')
      const first = await sendInvoice(into)

      await sendInvoice(into)
      await receiveContrl(into, contrlOf(String(first?.controlReference), '4'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    it('clears the rejection once a CONTRL accepts another test Interchange', async () => {
      const into = await testingWorkspace('Finally Confirmed Test Foods')
      const rejected = await sendInvoice(into)
      const accepted = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(rejected?.controlReference), '4'))

      const contrl = await receiveContrl(into, contrlOf(String(accepted?.controlReference), '7'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        contrlReceivedAt: contrl?.receivedAt,
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    it('records no rejection once the CONTRL step is complete', async () => {
      const into = await testingWorkspace('Confirmed Then Refused Test Foods')
      const accepted = await sendInvoice(into)
      const rejected = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(accepted?.controlReference), '7'))
      await receiveContrl(into, contrlOf(String(rejected?.controlReference), '4'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    it('records no rejection of an Interchange once the Trading Partner is in production', async () => {
      const into = await testingWorkspace('Refused Live Test Foods')
      const sent = await sendInvoice(into)

      await setTestMode(into, false)
      await receiveContrl(into, contrlOf(String(sent?.controlReference), '4'))

      await expect(onboardingOf(into)).resolves.toMatchObject({
        testRejectedAt: null,
        testRejectedRunId: null,
      })
    })

    describe('the test Interchange', () => {
      const withSample = async (into: InvoiceWorkspace) => {
        await connection.db
          .update(documentStructures)
          .set({
            sampleFileName: 'invoice-sample.json',
            sampleText: goldenInvoice,
            sampleTakenAt: new Date(),
          })
          .where(eq(documentStructures.id, into.documentStructureId))

        return into
      }

      const sendTest = async (into: InvoiceWorkspace) => {
        const queue = inMemoryRunQueue()

        const run = await Effect.runPromise(
          sendTestInterchange({
            workspaceId: into.id,
            tradingPartnerId: into.tradingPartnerId,
          }).pipe(pipelineServices(connection.db, queue)),
        )

        expect(queue.queued).toEqual([{ workspaceId: into.id, runId: run.id }])
        await processQueued(queue, deliveryByChannelType)

        return readRun(connection.db, run.id)
      }

      it('sends the sample of the Flow as a test Interchange and records its handover', async () => {
        const into = await withSample(await testingWorkspace('Sample Test Foods'))

        const sent = await sendTest(into)

        expect(sent).toMatchObject({
          status: 'delivered',
          manualSubmission: true,
          flowId: into.flowId,
          mappingVersionId: into.mappingVersionId,
          document: {
            channelId: into.inboundChannelId,
            fileName: 'invoice-sample.json',
            content: goldenInvoice,
          },
        })
        expect(sent?.output).toContain(`+${String(sent?.controlReference)}++++++1'UNH+`)
        expect(erp.received).toMatchObject([
          { body: Buffer.from(sent?.output ?? '', 'latin1').toString() },
        ])
        await expect(onboardingOf(into)).resolves.toEqual({
          testInterchangeSentAt: sent?.handedOverAt,
          contrlReceivedAt: null,
          testRejectedAt: null,
          testRejectedRunId: null,
        })
      })

      it('publishes the Run of the test Interchange', async () => {
        const into = await withSample(await testingWorkspace('Announced Test Foods'))

        const sent = await sendTest(into)

        expect(liveStatusesOf(sent?.id ?? '')).toEqual(['received', 'processing', 'delivered'])
      })

      it('clears the rejection of the earlier test Interchange', async () => {
        const into = await withSample(await testingWorkspace('Resent Test Foods'))
        const rejected = await sendTest(into)

        await receiveContrl(into, contrlOf(String(rejected?.controlReference), '4'))
        await expect(onboardingOf(into)).resolves.toMatchObject({
          testRejectedRunId: rejected?.id,
        })

        const queue = inMemoryRunQueue()

        await Effect.runPromise(
          sendTestInterchange({
            workspaceId: into.id,
            tradingPartnerId: into.tradingPartnerId,
          }).pipe(pipelineServices(connection.db, queue)),
        )

        await expect(onboardingOf(into)).resolves.toMatchObject({
          testRejectedAt: null,
          testRejectedRunId: null,
        })
      })
    })
  })

  describe('the Overdue check', () => {
    const limitHours = 24

    const atTimeAfter = (
      sent: { handedOverAt: Date | null } | undefined,
      after: Duration.Duration,
      check: Effect.Effect<unknown, never, Database | RunQueue | Delivery>,
    ) =>
      Effect.gen(function* () {
        const handedOverAt = sent?.handedOverAt

        assert.instanceOf(handedOverAt, Date)
        yield* TestClock.setTime(handedOverAt.getTime() + Duration.toMillis(after))
        yield* check
      }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
        Effect.provide(TestClock.layer()),
      )

    const checkAfter = (
      sent: { handedOverAt: Date | null } | undefined,
      after: Duration.Duration,
    ) => Effect.runPromise(atTimeAfter(sent, after, markOverdueInterchanges))

    it('keeps an Interchange pending within the time limit of its Trading Partner', async () => {
      const into = await acknowledgingWorkspace('Patient Foods')
      const sent = await sendInvoice(into)

      await checkAfter(sent, Duration.subtract(Duration.hours(limitHours), Duration.millis(1)))

      await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
        acknowledgementState: 'pending',
      })
    })

    it('marks an Interchange overdue once the time limit of its Trading Partner passed', async () => {
      const into = await acknowledgingWorkspace('Overdue Foods')
      const sent = await sendInvoice(into)

      await checkAfter(sent, Duration.hours(limitHours))

      await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
        status: 'delivered',
        acknowledgementState: 'overdue',
      })
    })

    it('publishes an Interchange marked overdue', async () => {
      const into = await acknowledgingWorkspace('Announced Overdue Foods')
      const sent = await sendInvoice(into)
      const before = liveStatusesOf(sent?.id ?? '').length

      await checkAfter(sent, Duration.hours(limitHours))

      expect(liveStatusesOf(sent?.id ?? '').slice(before)).toEqual(['delivered'])
    })

    it('reads the time limit of the Trading Partner of the Interchange', async () => {
      const into = await acknowledgingWorkspace('Hasty Foods')
      const sent = await sendInvoice(into)

      await connection.db
        .update(tradingPartners)
        .set({ acknowledgementTimeLimitHours: 2 })
        .where(eq(tradingPartners.id, into.tradingPartnerId))

      await checkAfter(sent, Duration.hours(2))

      await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
        acknowledgementState: 'overdue',
      })
    })

    it('keeps the Acknowledgement of an acknowledged Interchange', async () => {
      const into = await acknowledgingWorkspace('Answered Foods')
      const sent = await sendInvoice(into)

      await receiveContrl(into, contrlOf(String(sent?.controlReference), '4'))
      await checkAfter(sent, Duration.hours(limitHours))

      await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
        acknowledgementState: 'rejected',
      })
    })

    it('runs with the sweep of Runs', async () => {
      const into = await acknowledgingWorkspace('Swept Foods')
      const sent = await sendInvoice(into)

      const sweeping = Effect.runFork(
        atTimeAfter(
          sent,
          Duration.hours(limitHours),
          sweepRunsEvery({ interval: '1 hour', stuckAfter: '10 minutes' }),
        ),
      )

      try {
        await vi.waitFor(
          async () => {
            await expect(readRun(connection.db, sent?.id ?? '')).resolves.toMatchObject({
              acknowledgementState: 'overdue',
            })
          },
          { timeout: 2000, interval: 20 },
        )
      } finally {
        await Effect.runPromise(Fiber.interrupt(sweeping))
      }
    })
  })
})

describe('the CONTRL answering a received Interchange', () => {
  const ordersInterchange = golden('orders-reference.edi', 'latin1')

  const ordersMessage = ordersInterchange
    .split('\n')
    .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

  const fromHanseRetail = "UNB+UNOC:3+4071615111111:14+4389876511114:14+000324:1200+00000001'"

  const interchangeOf = (messages: string[][], count = messages.length) =>
    [fromHanseRetail, ...messages.flat(), `UNZ+${count}+00000001'`].join('\n')

  const answeringWorkspace = async (name: string) => {
    const into = await seedInvoiceWorkspace(connection.db, name)
    const orders = await addOrdersFlow(connection.db, into, { url: erp.url })

    return { ...into, orders }
  }

  const receivingContent = async (into: InvoiceWorkspace, content: ArrivingDocument['content']) => {
    const { messages, logger } = collectLogs()
    const queue = inMemoryRunQueue()

    const exit = await Effect.runPromiseExit(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content,
        manualSubmission: false,
      }).pipe(pipelineServices(connection.db, queue), Effect.provide(logger)),
    )

    return { exit, logs: messages, queue }
  }

  const receiving = (into: InvoiceWorkspace, content: string) =>
    receivingContent(into, { text: content })

  const receiveContent = async (into: InvoiceWorkspace, content: ArrivingDocument['content']) => {
    const { exit, logs } = await receivingContent(into, content)

    assert(Exit.isSuccess(exit), 'The Interchange was not received')

    return { receipt: exit.value, logs }
  }

  const receiveInterchange = (into: InvoiceWorkspace, content: string) =>
    receiveContent(into, { text: content })

  // Without a readable envelope, routing may still find an outbound Flow for the Document.
  const documentIdOf = (exit: Exit.Exit<{ document: { id: string } }, ReceiptRejected>) => {
    if (Exit.isSuccess(exit)) {
      return exit.value.document.id
    }

    const rejected = Cause.squash(exit.cause)

    assert(rejected instanceof ReceiptRejected, 'The receipt failed without a rejection')

    return rejected.documentId ?? ''
  }

  const sendWith = (delivery: DeliveryService, retryAfter: Duration.Input = '10 minutes') =>
    Effect.runPromise(
      sendAcknowledgements(retryAfter).pipe(
        pipelineServices(connection.db, inMemoryRunQueue(), delivery),
      ),
    )

  const recordingDelivery = ({ failing = false }: { failing?: boolean } = {}) => {
    const delivered: Array<{
      channelId: string
      name: string
      mediaType: string
      content: string
      isRetry: boolean
    }> = []

    const service: DeliveryService = (channel, { name, mediaType, content, isRetry = false }) =>
      Effect.suspend(() => {
        delivered.push({
          channelId: channel.id,
          name,
          mediaType: mediaType ?? '',
          content: content.toString('latin1').replace(/\+\d{6}:\d{4}\+/, '+YYMMDD:HHMM+'),
          isRetry,
        })

        return failing
          ? Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))
          : Effect.void
      })

    return {
      service,
      to: (channelId: string) =>
        delivered.flatMap(({ channelId: to, ...document }) => (to === channelId ? [document] : [])),
    }
  }

  // The bytes of the text read as ISO 8859-1 are not valid in UTF-8.
  const undecodableInterchange = (text: string, characterSet = 'UNOW') => {
    const decoded = decodeDocument(
      Buffer.from(text.replace('UNOC:3', `${characterSet}:3`), 'latin1'),
    )

    assert('undecodable' in decoded, 'The Interchange decoded in UTF-8')

    return decoded
  }

  const acknowledgementOf = async (documentId: string) => {
    const [row] = await connection.db
      .select()
      .from(acknowledgements)
      .where(eq(acknowledgements.documentId, documentId))

    return row
  }

  it('sends a CONTRL accepting a valid Interchange to the Channel of the outbound Flows of its Trading Partner', async () => {
    const into = await answeringWorkspace('Answered Orders')
    const delivery = recordingDelivery()

    await receiveInterchange(into, interchangeOf([ordersMessage]))
    await sendWith(delivery.service)

    expect(delivery.to(into.outboundChannelId)).toEqual([
      {
        name: 'CONTRL-1.edi',
        mediaType: 'application/edifact',
        content:
          "UNB+UNOC:3+4389876511114:14+4071615111111:14+YYMMDD:HHMM+1'" +
          "UNH+1+CONTRL:D:3:UN:EAN002'" +
          "UCI+00000001+4071615111111:14+4389876511114:14+7'" +
          "UCM+ME0001+ORDERS:D:96A:UN:EAN008+7'" +
          "UNT+4+1'" +
          "UNZ+1+1'",
        isRetry: false,
      },
    ])
  })

  it('marks the CONTRL to a Trading Partner in Test Mode with the test indicator', async () => {
    const into = await answeringWorkspace('Testing Orders')
    const delivery = recordingDelivery()

    await connection.db
      .update(tradingPartners)
      .set({ testMode: true })
      .where(eq(tradingPartners.id, into.tradingPartnerId))
    await receiveInterchange(into, interchangeOf([ordersMessage]))
    await sendWith(delivery.service)

    expect(delivery.to(into.outboundChannelId).map(({ content }) => content)).toEqual([
      "UNB+UNOC:3+4389876511114:14+4071615111111:14+YYMMDD:HHMM+1++++++1'" +
        "UNH+1+CONTRL:D:3:UN:EAN002'" +
        "UCI+00000001+4071615111111:14+4389876511114:14+7'" +
        "UCM+ME0001+ORDERS:D:96A:UN:EAN008+7'" +
        "UNT+4+1'" +
        "UNZ+1+1'",
    ])
  })

  it('records the test indicator of a received Interchange and mirrors it in the CONTRL', async () => {
    const into = await answeringWorkspace('Tested Orders')
    const delivery = recordingDelivery()
    const asTest = interchangeOf([ordersMessage]).replace("+00000001'", "+00000001++++++1'")

    const { receipt } = await receiveInterchange(into, asTest)
    await sendWith(delivery.service)

    expect(receipt.document).toMatchObject({ testIndicator: true })
    expect(receipt.runs).toHaveLength(1)
    expect(delivery.to(into.outboundChannelId).map(({ content }) => content)).toEqual([
      "UNB+UNOC:3+4389876511114:14+4071615111111:14+YYMMDD:HHMM+1++++++1'" +
        "UNH+1+CONTRL:D:3:UN:EAN002'" +
        "UCI+00000001+4071615111111:14+4389876511114:14+7'" +
        "UCM+ME0001+ORDERS:D:96A:UN:EAN008+7'" +
        "UNT+4+1'" +
        "UNZ+1+1'",
    ])
  })

  it('receives an Interchange without the test indicator from a Trading Partner in Test Mode', async () => {
    const into = await answeringWorkspace('Untested Orders')

    await connection.db
      .update(tradingPartners)
      .set({ testMode: true })
      .where(eq(tradingPartners.id, into.tradingPartnerId))

    const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))

    expect(receipt.document).toMatchObject({ testIndicator: false })
    expect(receipt.runs).toMatchObject([{ status: 'received' }])
  })

  it('rejects a broken Message in the CONTRL and leaves the Runs of the Interchange to their processing', async () => {
    const into = await answeringWorkspace('Broken Orders')
    const delivery = recordingDelivery()
    const withoutBgm = ordersMessage.filter((line) => !line.startsWith('BGM'))

    const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage, withoutBgm]))
    await sendWith(delivery.service)

    const [sent, ...more] = delivery.to(into.outboundChannelId)

    expect(more).toEqual([])
    expect(sent?.content).toContain(
      "UCM+ME0001+ORDERS:D:96A:UN:EAN008+7'UCM+ME0001+ORDERS:D:96A:UN:EAN008+4+29+UNT+1'",
    )
    await expect(
      Promise.all(receipt.runs.map(({ id }) => readRun(connection.db, id))),
    ).resolves.toMatchObject([{ status: 'received' }, { status: 'received' }])
  })

  it('marks the CONTRL rejecting a broken Message of a test Interchange with the test indicator', async () => {
    const into = await answeringWorkspace('Broken Test Orders')
    const delivery = recordingDelivery()
    const withoutBgm = ordersMessage.filter((line) => !line.startsWith('BGM'))
    const asTest = interchangeOf([withoutBgm]).replace("+00000001'", "+00000001++++++1'")

    await receiveInterchange(into, asTest)
    await sendWith(delivery.service)

    expect(delivery.to(into.outboundChannelId).map(({ content }) => content)).toEqual([
      "UNB+UNOC:3+4389876511114:14+4071615111111:14+YYMMDD:HHMM+1++++++1'" +
        "UNH+1+CONTRL:D:3:UN:EAN002'" +
        "UCI+00000001+4071615111111:14+4389876511114:14+7'" +
        "UCM+ME0001+ORDERS:D:96A:UN:EAN008+4+29+UNT+1'" +
        "UNT+4+1'" +
        "UNZ+1+1'",
    ])
  })

  it('answers a Duplicate with a CONTRL of its own', async () => {
    const into = await answeringWorkspace('Duplicate Orders')
    const delivery = recordingDelivery()

    await receiveInterchange(into, interchangeOf([ordersMessage]))
    await receiveInterchange(into, interchangeOf([ordersMessage]))
    await sendWith(delivery.service)

    expect(
      delivery
        .to(into.outboundChannelId)
        .map(({ name }) => name)
        .toSorted(),
    ).toEqual(['CONTRL-1.edi', 'CONTRL-2.edi'])
  })

  it('never answers a received CONTRL', async () => {
    const into = await answeringWorkspace('Acknowledging Orders')
    const delivery = recordingDelivery()

    await addContrlFlow(connection.db, into, { url: erp.url })

    const { receipt } = await receiveInterchange(
      into,
      "UNB+UNOC:3+4071615111111:14+4389876511114:14+261020:0800+77'" +
        "UNH+1+CONTRL:D:3:UN:EAN002'UCI+1+4389876511114:14+4071615111111:14+7'UNT+3+1'UNZ+1+77'",
    )

    await sendWith(delivery.service)

    expect(receipt.runs).toHaveLength(1)
    expect(delivery.to(into.outboundChannelId)).toEqual([])
    await expect(acknowledgementOf(receipt.document.id)).resolves.toBeUndefined()
  })

  it('answers no Document of an ERP', async () => {
    const into = await answeringWorkspace('Invoicing Foods')

    const { receipt } = await receiveInterchange(into, goldenInvoice)

    expect(receipt.runs).toHaveLength(1)
    await expect(acknowledgementOf(receipt.document.id)).resolves.toBeUndefined()
  })

  it('sends a CONTRL once', async () => {
    const into = await answeringWorkspace('Once Orders')
    const delivery = recordingDelivery()

    await receiveInterchange(into, interchangeOf([ordersMessage]))
    await sendWith(delivery.service)
    await sendWith(delivery.service, '0 millis')

    expect(delivery.to(into.outboundChannelId)).toHaveLength(1)
  })

  it('tries a CONTRL again after a failed delivery once the bound passed and fails no Run', async () => {
    const into = await answeringWorkspace('Unreachable Orders')
    const failing = recordingDelivery({ failing: true })
    const delivery = recordingDelivery()

    const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))
    await sendWith(failing.service)
    await sendWith(delivery.service)

    expect(failing.to(into.outboundChannelId)).toHaveLength(1)
    expect(delivery.to(into.outboundChannelId)).toEqual([])
    await expect(acknowledgementOf(receipt.document.id)).resolves.toMatchObject({
      handedOverAt: null,
      deliveryError: 'hostUnreachable',
    })
    await expect(readRun(connection.db, receipt.runs[0]?.id ?? '')).resolves.toMatchObject({
      status: 'received',
    })

    await sendWith(delivery.service, '0 millis')

    expect(delivery.to(into.outboundChannelId)).toMatchObject([
      { name: 'CONTRL-1.edi', isRetry: true },
    ])
    const sent = await acknowledgementOf(receipt.document.id)

    expect(sent?.handedOverAt).toBeInstanceOf(Date)
    expect(sent?.deliveryError).toBeNull()
  })

  it('sends a CONTRL whose attempt a worker restart cut off once the bound passed', async () => {
    const into = await answeringWorkspace('Restarted Orders')
    const delivery = recordingDelivery()

    const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))

    await connection.db
      .update(acknowledgements)
      .set({ deliveryAttemptedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(acknowledgements.documentId, receipt.document.id))
    await sendWith(delivery.service)

    expect(delivery.to(into.outboundChannelId)).toEqual([])

    await sendWith(delivery.service, '1 minute')

    expect(delivery.to(into.outboundChannelId)).toMatchObject([{ isRetry: true }])
  })

  it('sends the CONTRLs with the sweep of Runs', async () => {
    const into = await answeringWorkspace('Swept Orders')
    const delivery = recordingDelivery()

    await receiveInterchange(into, interchangeOf([ordersMessage]))

    const sweeping = Effect.runFork(
      sweepRunsEvery({ interval: '1 hour', stuckAfter: '10 minutes' }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue(), delivery.service),
      ),
    )

    try {
      await vi.waitFor(
        () => {
          expect(delivery.to(into.outboundChannelId)).toHaveLength(1)
        },
        { timeout: 2000, interval: 20 },
      )
    } finally {
      await Effect.runPromise(Fiber.interrupt(sweeping))
    }
  })

  describe('a CONTRL recorded but not sent', () => {
    const recordedFor = async (
      into: InvoiceWorkspace,
      content: ArrivingDocument['content'] = { text: interchangeOf([ordersMessage]) },
    ) => {
      const delivery = recordingDelivery()
      const { receipt, logs } = await receiveContent(into, content)

      await sendWith(delivery.service, '0 millis')

      expect(delivery.to(into.outboundChannelId)).toEqual([])

      return { acknowledgement: await acknowledgementOf(receipt.document.id), logs }
    }

    it('names a Trading Partner without an outbound EDIFACT Flow', async () => {
      const into = await answeringWorkspace('Inbound-only Orders')

      await connection.db.delete(flows).where(eq(flows.id, into.flowId))

      const { acknowledgement, logs } = await recordedFor(into)

      expect(acknowledgement).toMatchObject({
        notSentReason: 'noOutboundChannel',
        channelId: null,
        controlReference: 1,
      })
      expect(acknowledgement?.content).toContain(
        "UCI+00000001+4071615111111:14+4389876511114:14+7'",
      )
      expect(logs).toContainEqual([
        `The CONTRL for Document ${acknowledgement?.documentId ?? ''} is not sent: no outbound EDIFACT Flow of its Trading Partner names a Channel`,
      ])
    })

    it('names outbound EDIFACT Flows of different Channels', async () => {
      const into = await answeringWorkspace('Two-channel Orders')

      const [other] = await connection.db
        .insert(channels)
        .values({
          workspaceId: into.id,
          tradingPartnerId: into.tradingPartnerId,
          type: 'http',
          direction: 'outbound',
          name: 'Hanse Retail dispatch inbox',
          url: erp.url,
        })
        .returning()

      await connection.db.insert(flows).values({
        workspaceId: into.id,
        tradingPartnerId: into.tradingPartnerId,
        messageType: 'DESADV',
        name: 'Dispatch advices to Hanse Retail',
        inboundChannelId: into.inboundChannelId,
        destinationChannelId: other?.id ?? '',
        mappingVersionId: into.mappingVersionId,
      })

      const { acknowledgement, logs } = await recordedFor(into)

      expect(acknowledgement).toMatchObject({ notSentReason: 'ambiguousChannel', channelId: null })
      expect(logs).toContainEqual([
        `The CONTRL for Document ${acknowledgement?.documentId ?? ''} is not sent: the outbound EDIFACT Flows of its Trading Partner name different Channels`,
      ])
    })

    it('names a seeded Channel', async () => {
      const into = await answeringWorkspace('Demo Orders')

      await markSeeded(connection.db, into.outboundChannelId)

      const { acknowledgement, logs } = await recordedFor(into)

      expect(acknowledgement).toMatchObject({ notSentReason: 'seededChannel', channelId: null })
      expect(logs).toContainEqual([
        `The CONTRL for Document ${acknowledgement?.documentId ?? ''} is not sent: a seeded Channel never sends`,
      ])
    })

    it('stays unsent when its Channel is seeded after the CONTRL was recorded', async () => {
      const into = await answeringWorkspace('Seeded Later Orders')
      const delivery = recordingDelivery()
      const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))

      await markSeeded(connection.db, into.outboundChannelId)
      await sendWith(delivery.service, '0 millis')

      expect(delivery.to(into.outboundChannelId)).toEqual([])
      await expect(acknowledgementOf(receipt.document.id)).resolves.toMatchObject({
        channelId: into.outboundChannelId,
        deliveryAttemptedAt: null,
        handedOverAt: null,
      })
    })

    it('names a Document received over a seeded Channel', async () => {
      const into = await answeringWorkspace('Seeded Source Orders')

      await markSeeded(connection.db, into.inboundChannelId)

      const { acknowledgement, logs } = await recordedFor(into)

      expect(acknowledgement).toMatchObject({ notSentReason: 'seededChannel', channelId: null })
      expect(logs).toContainEqual([
        `The CONTRL for Document ${acknowledgement?.documentId ?? ''} is not sent: a seeded Channel never sends`,
      ])
    })

    it('stays unsent when the Channel of its Document is seeded after the CONTRL was recorded', async () => {
      const into = await answeringWorkspace('Source Seeded Later Orders')
      const delivery = recordingDelivery()
      const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))

      await markSeeded(connection.db, into.inboundChannelId)
      await sendWith(delivery.service, '0 millis')

      expect(delivery.to(into.outboundChannelId)).toEqual([])
      await expect(acknowledgementOf(receipt.document.id)).resolves.toMatchObject({
        channelId: into.outboundChannelId,
        deliveryAttemptedAt: null,
        handedOverAt: null,
      })
    })

    it('names the header of an Interchange whose recipient is not valid in its character set', async () => {
      const into = await answeringWorkspace('Mis-encoded Orders')

      const decoded = undecodableInterchange(
        interchangeOf([ordersMessage]).replace('4389876511114:14', '438987651111\u00e4:14'),
      )

      const { acknowledgement, logs } = await recordedFor(into, decoded)

      expect(acknowledgement).toMatchObject({
        notSentReason: 'unechoableInterchangeHeader',
        channelId: into.outboundChannelId,
        controlReference: null,
        content: null,
      })
      expect(logs).toContainEqual([
        `The CONTRL for Document ${acknowledgement?.documentId ?? ''} is not sent: ${decoded.undecodable.message}`,
      ])
    })

    it('names a Workspace without a GLN', async () => {
      const into = await answeringWorkspace('GLN-less Orders')

      await connection.db.update(workspaces).set({ gln: null }).where(eq(workspaces.id, into.id))

      await expect(recordedFor(into)).resolves.toMatchObject({
        acknowledgement: {
          notSentReason: 'workspaceGlnMissing',
          channelId: into.outboundChannelId,
          controlReference: null,
          content: null,
        },
      })
    })
  })

  const misEncodedOrders = ordersMessage.map((line) => line.replace('+128576+', '+1285\u00e476+'))

  it.each([
    ['its character set', 'UNOW'],
    ['UTF-8 under a syntax identifier not listed', 'UNOX'],
  ])('rejects an Interchange not valid in %s in a CONTRL sent', async (_case, characterSet) => {
    const into = await answeringWorkspace(`Mis-encoded ${characterSet} Order Lines`)
    const delivery = recordingDelivery()

    const { exit } = await receivingContent(
      into,
      undecodableInterchange(interchangeOf([misEncodedOrders]), characterSet),
    )

    await sendWith(delivery.service)

    expect(delivery.to(into.outboundChannelId).map(({ content }) => content)).toEqual([
      "UNB+UNOC:3+4389876511114:14+4071615111111:14+YYMMDD:HHMM+1'" +
        "UNH+1+CONTRL:D:3:UN:EAN002'" +
        "UCI+00000001+4071615111111:14+4389876511114:14+4+21'" +
        "UNT+3+1'" +
        "UNZ+1+1'",
    ])
    await expect(acknowledgementOf(documentIdOf(exit))).resolves.toMatchObject({
      notSentReason: null,
    })
  })

  it('answers no Interchange not valid in its character set whose UNB cannot be read', async () => {
    const into = await answeringWorkspace('Mis-encoded Headless Orders')
    const delivery = recordingDelivery()

    const { exit, queue } = await receivingContent(
      into,
      undecodableInterchange(
        interchangeOf([misEncodedOrders])
          .replace("+00000001'", "'")
          .replace("UNZ+1+00000001'", "UNZ+1'"),
      ),
    )

    await processQueued(queue, delivery.service)
    await sendWith(delivery.service)

    const [run] = await connection.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.documentId, documentIdOf(exit)))

    await expect(readRun(connection.db, run?.id ?? '')).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'parse',
    })
    await expect(acknowledgementOf(documentIdOf(exit))).resolves.toBeUndefined()
    expect(delivery.to(into.outboundChannelId)).toEqual([])
    expect(erp.received).toHaveLength(0)
  })

  it('rejects an Interchange whose envelope is broken in a CONTRL sent', async () => {
    const into = await answeringWorkspace('Miscounted Orders')
    const delivery = recordingDelivery()

    const { exit } = await receiving(into, interchangeOf([ordersMessage], 2))
    await sendWith(delivery.service)

    const sent = delivery.to(into.outboundChannelId)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toContain('UCI+00000001+4071615111111:14+4389876511114:14+4+29+UNZ')

    const acknowledgement = await acknowledgementOf(documentIdOf(exit))

    expect(acknowledgement?.notSentReason).toBeNull()
    expect(acknowledgement?.handedOverAt).toBeInstanceOf(Date)
  })

  it('answers an Interchange whose Message Type no Flow takes', async () => {
    const into = await answeringWorkspace('Price Catalogue')
    const delivery = recordingDelivery()

    const pricat = ordersMessage.map((line) => line.replace('ORDERS:D:96A', 'PRICAT:D:96A'))

    const { exit } = await receiving(into, interchangeOf([pricat]))
    await sendWith(delivery.service)

    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      reason: 'noRoutedMessage',
    })
    const sent = delivery.to(into.outboundChannelId)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toContain(
      "UCI+00000001+4071615111111:14+4389876511114:14+7'UCM+ME0001+PRICAT",
    )
  })

  it('answers no Interchange from a sender without a Trading Partner', async () => {
    const into = await answeringWorkspace('Stranger Orders')

    const { receipt, logs } = await receiveInterchange(
      into,
      interchangeOf([ordersMessage]).replace('4071615111111:14', '4012345000009:14'),
    )

    await expect(acknowledgementOf(receipt.document.id)).resolves.toBeUndefined()
    expect(logs).toContainEqual([
      `The Interchange of Document ${receipt.document.id} gets no CONTRL: no Trading Partner has the GLN 4012345000009 of its sender`,
    ])
  })

  it('answers no Interchange whose UNB cannot be read', async () => {
    const into = await answeringWorkspace('Headless Orders')

    const { exit } = await receiving(
      into,
      interchangeOf([ordersMessage])
        .replace("+00000001'", "'")
        .replace("UNZ+1+00000001'", "UNZ+1'"),
    )

    await expect(acknowledgementOf(documentIdOf(exit))).resolves.toBeUndefined()
  })

  it('keeps the Runs of an Interchange whose CONTRL cannot be recorded', async () => {
    const into = await answeringWorkspace('Exhausted Orders')

    await connection.db
      .update(tradingPartners)
      .set({ nextControlReference: 2_147_483_647 })
      .where(eq(tradingPartners.id, into.tradingPartnerId))

    const { receipt, logs } = await receiveInterchange(into, interchangeOf([ordersMessage]))

    expect(receipt.runs).toHaveLength(1)
    await expect(acknowledgementOf(receipt.document.id)).resolves.toBeUndefined()
    expect(logs).toContainEqual([`The CONTRL for Document ${receipt.document.id} was not recorded`])
  })

  it('records no attempt over a later one', async () => {
    const into = await answeringWorkspace('Slow Orders')
    const laterAttempt = new Date(Date.now() + 60_000)

    const { receipt } = await receiveInterchange(into, interchangeOf([ordersMessage]))

    const overtaken: DeliveryService = () =>
      Effect.andThen(
        Effect.promise(() =>
          connection.db
            .update(acknowledgements)
            .set({ deliveryAttemptedAt: laterAttempt })
            .where(eq(acknowledgements.documentId, receipt.document.id)),
        ),
        Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' })),
      )

    await sendWith(overtaken)

    await expect(acknowledgementOf(receipt.document.id)).resolves.toMatchObject({
      deliveryAttemptedAt: laterAttempt,
      deliveryError: null,
    })
  })
})

describe('the live events of Runs', () => {
  it('publishes a received Run with its summary', async () => {
    const { runId } = await receiveInvoice()
    const received = await readRun(connection.db, runId)

    expect(testLiveEvents.published.filter(({ event }) => event.run.id === runId)).toEqual([
      {
        workspaceId: workspace.id,
        event: {
          type: 'run.changed',
          run: {
            id: runId,
            receivedAt: received?.receivedAt.toISOString(),
            tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
            messageType: 'INVOIC',
            direction: 'outbound',
            flow: { id: workspace.flowId, name: 'Invoices to Hanse Retail' },
            manualSubmission: true,
            businessReference: null,
            interchange: null,
            status: 'received',
            failureStage: null,
            problem: null,
          },
        },
      },
    ])
  })

  it('publishes a Run as it is processed and once it is delivered', async () => {
    const { queue, runId } = await receiveInvoice()

    await processQueued(queue)

    expect(liveStatusesOf(runId)).toEqual(['received', 'processing', 'delivered'])
  })

  it('publishes a stuck Run released to be processed again', async () => {
    const { runId } = await receiveInvoice()

    await leaveStuck(runId)
    await sweepStuck()

    expect(liveStatusesOf(runId)).toEqual(['received', 'received'])
  })

  it('publishes a stuck Run failed as a defect', async () => {
    const { runId } = await receiveInvoice()

    await connection.db.execute(
      sql`update run_steps set status = 'running', started_at = now() where run_id = ${runId} and stage = 'mapping'`,
    )
    await leaveStuck(runId)
    await sweepStuck()

    expect(liveStatusesOf(runId)).toEqual(['received', 'failed'])
  })

  it('publishes a Run reopened by its Retry', async () => {
    const unreachable: DeliveryService = () =>
      Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))

    const { queue, runId } = await receiveInvoice()

    await processQueued(queue, unreachable)
    await Effect.runPromise(
      retryRun({ workspaceId: workspace.id, runId }).pipe(
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

    expect(liveStatusesOf(runId)).toEqual(['received', 'processing', 'failed', 'received'])
  })

  it('publishes the new Run of a Reprocess and the Run it replaces', async () => {
    const unknownUnit = JSON.stringify({
      ...invoiceDocument,
      lines: invoiceDocument.lines.map((line) => ({ ...line, unit: 'KG' })),
    })

    const { queue, runId } = await receiveInvoice(unknownUnit)

    await processQueued(queue)

    const reprocessed = await Effect.runPromise(
      reprocessRun({
        workspaceId: workspace.id,
        runId,
        mappingVersionId: workspace.mappingVersionId,
      }).pipe(pipelineServices(connection.db, inMemoryRunQueue())),
    )

    expect(liveStatusesOf(runId)).toEqual(['received', 'processing', 'failed', 'failed'])
    expect(liveStatusesOf(reprocessed.runId)).toEqual(['received'])
  })

  it('publishes the changes of several Runs at the same time', async () => {
    const runIds = [(await receiveInvoice()).runId, (await receiveInvoice()).runId]
    let inFlight = 0
    let mostInFlight = 0

    const slow = {
      publish: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            inFlight += 1
            mostInFlight = Math.max(mostInFlight, inFlight)
          }),
          () => Effect.sleep('20 millis'),
          () =>
            Effect.sync(() => {
              inFlight -= 1
            }),
        ),
    } satisfies LiveEventsService

    await Effect.runPromise(
      publishRunChanges(runIds).pipe(
        Effect.provideService(LiveEvents, slow),
        pipelineServices(connection.db, inMemoryRunQueue()),
      ),
    )

    expect(mostInFlight).toBe(2)
  })

  it('keeps a Run that its live event fails to announce', async () => {
    const { logger, messages } = collectLogs()

    const unpublished = {
      publish: () => Effect.die(new Error('Redis is unreachable')),
    } satisfies LiveEventsService

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: workspace.id,
        channelId: workspace.inboundChannelId,
        fileName: 'invoice.json',
        content: { text: goldenInvoice },
        manualSubmission: true,
      }).pipe(
        Effect.provideService(LiveEvents, unpublished),
        pipelineServices(connection.db, inMemoryRunQueue()),
        Effect.provide(logger),
      ),
    )

    const runId = receipt.runs[0]?.id ?? ''

    await expect(readRun(connection.db, runId)).resolves.toMatchObject({ status: 'received' })
    expect(messages).toContainEqual([`Changes of Runs ${runId} not published`])
  })
})
