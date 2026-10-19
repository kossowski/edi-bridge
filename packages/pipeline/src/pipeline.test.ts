import { eq } from 'drizzle-orm'
import { type Duration, Effect, Exit, Fiber } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { sftpChannelDelivery } from '@edi-bridge/channels'
import { startTestSftpServer, type TestSftpServer } from '@edi-bridge/channels/testing'
import { channels, connect, type Connection, documents, flows, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import {
  type ArrivingDocument,
  bullmqRunQueue,
  type DeliveryService,
  processRun,
  queueReceivedRunsEvery,
  ReceiptRejected,
  receive,
} from './index'
import {
  deliverOverSftp,
  golden,
  goldenInvoice,
  goldenInvoicMessage,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
  testSecrets,
} from './testing'

let testDatabase: TestDatabase

let sftp: TestSftpServer

let connection: Connection

let workspace: InvoiceWorkspace

const sftpLogin = () => ({
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  password: sftp.password,
  remotePath: '/upload',
})

beforeAll(async () => {
  ;[testDatabase, sftp] = await Promise.all([startTestDatabase(), startTestSftpServer()])
  connection = connect(testDatabase.url)
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
  await deliverOverSftp(connection.db, workspace, sftpLogin())
}, 180_000)

afterAll(async () => {
  await connection.close()
  await Promise.all([testDatabase.stop(), sftp.stop()])
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
      content,
      manualSubmission: true,
    }).pipe(pipelineServices(connection.db, queue)),
  )

  return { queue, runId: receipt.runs[0]?.id ?? '' }
}

const sftpDelivery: DeliveryService = sftpChannelDelivery({
  secrets: testSecrets,
  timeoutMs: 1500,
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

// The UNB date and time, YYMMDD:HHMM in UTC.
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
      `UNB+UNOC:3+4389876511113:14+4071615111110:14+${time}+${reference}'` +
        invoicSegments +
        `UNZ+1+${reference}'`,
    )

    const delivered = await remoteFile(`/upload/INVOIC-${reference}.edi`)

    expect(delivered).toBe(run?.output)
    expect(delivered.match(/UNH\+/g)).toHaveLength(1)
  })

  it('fails a Run at delivery when its SFTP Channel is unreachable and keeps its Interchange', async () => {
    const unreachable = await seedInvoiceWorkspace(connection.db, 'Unreachable Foods')

    await deliverOverSftp(connection.db, unreachable, {
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
      error: { code: 'hostUnreachable', position: null },
      problem: { reason: 'unreachable', fixTarget: null },
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
      error: { code: 'deliveryDefect', position: null },
      problem: { reason: 'unreachable', fixTarget: null },
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
      error: { code: 'glnMissing', position: null },
      problem: { reason: 'missingField', fixTarget: null },
    })
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
