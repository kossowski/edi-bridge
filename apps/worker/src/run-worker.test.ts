import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
} from '@edi-bridge/channels/testing'
import { connect, type Connection, documents, mappings, runs } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'
import { bullmqRunQueue, receive, type RunQueueService } from '@edi-bridge/pipeline'
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
  receiveOverSftp,
  seedInvoiceWorkspace,
  startTestRedis,
  type TestRedis,
  testSecrets,
} from '@edi-bridge/pipeline/testing'

import { startRunWorker } from './run-worker.js'

let testDatabase: TestDatabase

let testRedis: TestRedis

let sftp: TestSftpServer

let erp: TestErp

let ordersChannelId: string

let connection: Connection

let workspace: InvoiceWorkspace

let queue: ReturnType<typeof bullmqRunQueue>

let worker: ReturnType<typeof startRunWorker>

beforeAll(async () => {
  ;[testDatabase, testRedis, sftp, erp] = await Promise.all([
    startTestDatabase(),
    startTestRedis(),
    startTestSftpServer(),
    startTestErp(),
  ])
  connection = connect(testDatabase.url)
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
  await deliverOverSftp(connection.db, workspace, {
    host: sftp.host,
    port: sftp.port,
    username: sftp.username,
    password: sftp.password,
    remotePath: '/upload',
  })
  ordersChannelId = await pollOrders()
  queue = bullmqRunQueue(testRedis.url)
  worker = startRunWorker({
    redisUrl: testRedis.url,
    db: connection.db,
    secrets: testSecrets,
    requeueInterval: '100 millis',
    pollingMinute: '100 millis',
  })
  // Each SFTP operation takes an SSH session, so the receipt of the ORDERS file outlasts a test.
  await vi.waitFor(
    async () => {
      expect((await sftp.exec(`ls -A ${sftp.home}/upload/orders`)).output).toBe('')
    },
    { timeout: 30_000, interval: 100 },
  )
}, 180_000)

afterAll(async () => {
  await worker.close()
  await queue.close()
  await connection.close()
  await Promise.all([testDatabase.stop(), testRedis.stop(), sftp.stop(), erp.stop()])
})

const ordersInterchange = golden('orders-reference.edi', 'latin1')

// An ORDERS Interchange waits on the SFTP server of another Workspace before the worker starts.
async function pollOrders() {
  const orders = await seedInvoiceWorkspace(connection.db, 'Order Foods')
  const { flowId } = await addOrdersFlow(connection.db, orders, { url: erp.url })
  const remotePath = '/upload/orders'
  const path = `${sftp.home}${remotePath}/orders.edi`

  await sftp.exec(
    [
      `install -d -m 777 ${sftp.home}${remotePath}`,
      `echo ${Buffer.from(ordersInterchange, 'latin1').toString('base64')} | base64 -d > ${path}`,
    ].join(' && '),
  )

  return receiveOverSftp(
    connection.db,
    orders,
    {
      host: sftp.host,
      port: sftp.port,
      username: sftp.username,
      password: sftp.password,
      remotePath,
    },
    { flowId },
  )
}

const arrive = async (
  content: string,
  runQueue: { service: RunQueueService } = queue,
  into: InvoiceWorkspace = workspace,
) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: into.id,
      channelId: into.inboundChannelId,
      fileName: 'invoice.json',
      content,
      manualSubmission: false,
    }).pipe(pipelineServices(connection.db, runQueue)),
  )

  return receipt.runs[0]?.id ?? ''
}

const processed = (runId: string) =>
  vi.waitFor(
    async () => {
      const run = await readRun(connection.db, runId)

      expect(['delivered', 'failed']).toContain(run?.status)

      return run
    },
    { timeout: 1500, interval: 50 },
  )

const remoteFile = async (path: string) =>
  Buffer.from((await sftp.exec(`base64 ${sftp.home}${path}`)).output, 'base64').toString('latin1')

describe('the worker', () => {
  it('delivers a Run queued at the receipt of a Document as an INVOIC to the SFTP Channel', async () => {
    const run = await processed(await arrive(goldenInvoice))

    expect(run).toMatchObject({
      status: 'delivered',
      manualSubmission: false,
      failureStage: null,
      mappingVersionId: workspace.mappingVersionId,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'succeeded' },
      ],
    })
    expect(run?.output).toContain(goldenInvoicMessage.split('\n').join(''))
    await expect(remoteFile(`/upload/INVOIC-${String(run?.controlReference)}.edi`)).resolves.toBe(
      run?.output,
    )
  })

  it('stops a queued Run with an invalid INVOIC at validation and keeps no output', async () => {
    const tooLongInvoiceNumber = JSON.stringify({
      ...z.looseObject({}).parse(JSON.parse(goldenInvoice)),
      invoiceNumber: 'INV-'.repeat(10),
    })

    const run = await processed(await arrive(tooLongInvoiceNumber))

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      output: null,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'failed' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
  })

  it('stops a queued Run with an unreadable Document at mapping', async () => {
    const run = await processed(await arrive('not json'))

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      output: null,
      error: { code: 'invalidJson' },
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'failed' },
        { stage: 'validation', status: 'skipped' },
        { stage: 'delivery', status: 'skipped' },
      ],
    })
  })

  it('fails a Run that stops on a defect and reports the defect', async () => {
    const defective = await seedInvoiceWorkspace(connection.db, 'Defective Foods')
    const reported: string[] = []

    // An outbound Flow pinned to an inbound Mapping is a defect of the stored setup.
    await connection.db
      .update(mappings)
      .set({ messageType: 'ORDERS' })
      .where(eq(mappings.id, defective.mappingId))
    await deliverOverSftp(connection.db, defective, {
      host: sftp.host,
      port: sftp.port,
      username: sftp.username,
      password: sftp.password,
      remotePath: '/upload',
    })
    worker.worker.on('failed', (job) => {
      reported.push(job?.data.runId ?? '')
    })

    const runId = await arrive(goldenInvoice, queue, defective)

    await expect(processed(runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: { code: 'processingDefect' },
    })
    await vi.waitFor(() => {
      expect(reported).toContain(runId)
    })
  })

  it('processes a Run received but not queued after the next sweep', async () => {
    const runId = await arrive(goldenInvoice, inMemoryRunQueue())

    await expect(processed(runId)).resolves.toMatchObject({ status: 'delivered' })
  })

  it('polls an inbound SFTP Channel and posts its ORDERS Message to the HTTP Channel of the ERP', async () => {
    const delivered = await vi.waitFor(
      async () => {
        const [run] = await connection.db
          .select({ id: runs.id })
          .from(runs)
          .innerJoin(documents, eq(documents.id, runs.documentId))
          .where(eq(documents.channelId, ordersChannelId))

        const read = await readRun(connection.db, run?.id ?? '')

        expect(read?.status).toBe('delivered')

        return read
      },
      { timeout: 1500, interval: 50 },
    )

    expect(delivered?.steps.at(-1)).toMatchObject({ stage: 'delivery', status: 'succeeded' })
    expect(erp.received).toMatchObject([
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    ])
  })
})
