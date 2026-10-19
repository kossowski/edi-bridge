import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { startTestSftpServer, type TestSftpServer } from '@edi-bridge/channels/testing'
import { connect, type Connection } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'
import { bullmqRunQueue, receive, type RunQueueService } from '@edi-bridge/pipeline'
import {
  deliverOverSftp,
  goldenInvoice,
  goldenInvoicMessage,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
  startTestRedis,
  type TestRedis,
  testSecrets,
} from '@edi-bridge/pipeline/testing'

import { startRunWorker } from './run-worker.js'

let testDatabase: TestDatabase

let testRedis: TestRedis

let sftp: TestSftpServer

let connection: Connection

let workspace: InvoiceWorkspace

let queue: ReturnType<typeof bullmqRunQueue>

let worker: ReturnType<typeof startRunWorker>

beforeAll(async () => {
  ;[testDatabase, testRedis, sftp] = await Promise.all([
    startTestDatabase(),
    startTestRedis(),
    startTestSftpServer(),
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
  queue = bullmqRunQueue(testRedis.url)
  worker = startRunWorker({
    redisUrl: testRedis.url,
    db: connection.db,
    secrets: testSecrets,
    requeueInterval: '100 millis',
  })
}, 180_000)

afterAll(async () => {
  await worker.close()
  await queue.close()
  await connection.close()
  await Promise.all([testDatabase.stop(), testRedis.stop(), sftp.stop()])
})

const arrive = async (content: string, runQueue: { service: RunQueueService } = queue) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: workspace.id,
      channelId: workspace.inboundChannelId,
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
    { timeout: 3000, interval: 50 },
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

  it('processes a Run received but not queued after the next sweep', async () => {
    const runId = await arrive(goldenInvoice, inMemoryRunQueue())

    await expect(processed(runId)).resolves.toMatchObject({ status: 'delivered' })
  })
})
