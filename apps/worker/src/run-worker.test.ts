import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { connect, type Connection } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'
import { bullmqRunQueue, receive } from '@edi-bridge/pipeline'
import {
  goldenInvoice,
  goldenInvoicMessage,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
  startTestRedis,
  type TestRedis,
} from '@edi-bridge/pipeline/testing'

import { startRunWorker } from './run-worker.js'

let testDatabase: TestDatabase

let testRedis: TestRedis

let connection: Connection

let workspace: InvoiceWorkspace

let queue: ReturnType<typeof bullmqRunQueue>

let worker: ReturnType<typeof startRunWorker>

beforeAll(async () => {
  ;[testDatabase, testRedis] = await Promise.all([startTestDatabase(), startTestRedis()])
  connection = connect(testDatabase.url)
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
  queue = bullmqRunQueue(testRedis.url)
  worker = startRunWorker({ redisUrl: testRedis.url, db: connection.db })
}, 120_000)

afterAll(async () => {
  await worker.close()
  await queue.close()
  await connection.close()
  await Promise.all([testDatabase.stop(), testRedis.stop()])
})

const arrive = async (content: string) => {
  const receipt = await Effect.runPromise(
    receive({
      workspaceId: workspace.id,
      channelId: workspace.inboundChannelId,
      fileName: 'invoice.json',
      content,
      manualSubmission: false,
    }).pipe(pipelineServices(connection.db, queue)),
  )

  return receipt.runs[0]?.id ?? ''
}

const processed = (runId: string) =>
  vi.waitFor(
    async () => {
      const run = await readRun(connection.db, runId)

      expect(run?.steps.find(({ stage }) => stage === 'validation')?.finishedAt).not.toBeNull()

      return run
    },
    { timeout: 3000, interval: 50 },
  )

describe('the worker', () => {
  it('processes a Run queued at the receipt of a Document into a valid INVOIC', async () => {
    const run = await processed(await arrive(goldenInvoice))

    expect(run).toMatchObject({
      status: 'processing',
      manualSubmission: false,
      failureStage: null,
      mappingVersionId: workspace.mappingVersionId,
      output: goldenInvoicMessage,
      steps: [
        { stage: 'receipt', status: 'succeeded' },
        { stage: 'mapping', status: 'succeeded' },
        { stage: 'validation', status: 'succeeded' },
        { stage: 'delivery', status: 'pending' },
      ],
    })
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
})
