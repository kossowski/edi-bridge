import { eq } from 'drizzle-orm'
import { type Duration, Effect, Exit, Fiber } from 'effect'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { secretBox, secretKeyBytes, sftpChannelDelivery } from '@edi-bridge/channels'
import {
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
} from '@edi-bridge/channels/testing'
import { type CharacterSet, withCheckDigit } from '@edi-bridge/contracts'
import {
  channels,
  connect,
  type Connection,
  documents,
  flows,
  mappings,
  runs,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import {
  type ArrivingDocument,
  bullmqRunQueue,
  channelDelivery,
  type DeliveryService,
  processRun,
  queueReceivedRunsEvery,
  ReceiptRejected,
  receive,
} from './index'
import {
  addOrdersFlow,
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
        content: interchange,
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

    const exit = await rejection({ channelId, content: ordersOnly })

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
        content: ordersInterchange([ordersMessage, ordersMessage, ordersMessage]),
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
        content: ordersInterchange([ordersMessage, withoutSegment, ordersMessage]),
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
        content: interchangeFrom(withCheckDigit('430000000002'), [ordersMessage]),
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
        content: interchangeFrom(withCheckDigit('430000000005'), [invoicMessage, ordersMessage]),
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
    expect(run?.output).toMatch(/^UNA:\+\.\? 'UNB\+UNOB:3\+4389876511113:14\+.*:::Rudi Ruessel'/)
    await expect(remoteFile(`/upload/unob/INVOIC-${reference}.edi`)).resolves.toBe(run?.output)
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
        problem: { reason: 'invalidContent', fixTarget: null },
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
      error: { code: 'characterSetUnsupported', position: null },
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

  it('fails a Run at delivery as unreachable when the database fails in the delivery step', async () => {
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
      error: { code: 'channelDefect', position: null },
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
      error: { code: 'glnMissing', position: null },
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
      error: { code: 'glnMissing', position: null },
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
      error: { code: 'channelDefect', position: null },
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
      error: { code: 'processingDefect', position: null },
      problem: { reason: 'invalidContent', fixTarget: null },
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

  const interchangeOf = (messages: string[][]) =>
    [ordersInterchange.split('\n')[0], ...messages.flat(), `UNZ+${messages.length}+00000001'`].join(
      '\n',
    )

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
        content,
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
      error: { code: 'noLookupMatch', position: null },
      problem: {
        reason: 'missingCode',
        fixTarget: { kind: 'mapping', mappingId: into.orders.mappingId },
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
      error: { code: 'segment-count-mismatch', position: { segment: 44, tag: 'UNT' } },
      problem: { reason: 'unreadable', fixTarget: null },
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
      error: { position: { segment: 25, tag: 'BGM', element: 3 } },
      problem: { reason: 'invalidContent', fixTarget: null },
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
      error: { code: 'unexpectedResponse', position: null },
      problem: { reason: 'unreachable', fixTarget: null },
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

  it('processes an inbound Run handed out twice only once', async () => {
    const into = await ordersWorkspace('Twice Foods')
    const queue = inMemoryRunQueue()

    const receipt = await Effect.runPromise(
      receive({
        workspaceId: into.id,
        channelId: into.inboundChannelId,
        fileName: 'orders.edi',
        content: ordersInterchange,
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
        content: ordersInterchange,
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
      error: { code: 'processingDefect', position: null },
      problem: { reason: 'invalidContent', fixTarget: null },
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
})
