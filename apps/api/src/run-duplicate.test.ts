import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  manualSubmissionSchema,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  submitDocumentEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { processRun } from '@edi-bridge/pipeline'
import {
  addOrdersFlow,
  golden,
  type InvoiceWorkspace,
  pipelineServices,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import {
  addMember,
  type Client,
  signIn,
  startTestApi,
  submittedDocument,
  type TestApi,
} from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

const ordersInterchange = golden('orders-reference.edi', 'latin1')

const submitted = async (content: string) => {
  const response = await admin.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId: workspace.inboundChannelId,
      document: submittedDocument('orders.edi', content, 'windows-1252'),
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  const [run] = manualSubmissionSchema.parse(response.json()).runs

  if (!run) {
    throw new Error('The submission created no Run')
  }

  return run
}

// The order number in the BGM segment of the golden ORDERS.
const businessReference = '128576'

let original: string

let duplicate: string

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')
  await addOrdersFlow(api.connection.db, workspace, { url: 'http://127.0.0.1:9/orders' })

  const member = {
    name: 'Nordwind Foods admin',
    email: 'admin@nordwind-foods.example',
    password: 'nordwind-foods-admin-password',
    workspaceId: workspace.id,
    role: 'admin' as const,
  }

  await addMember(api.connection.db, member)
  admin = await signIn(api.app, member)

  original = (await submitted(ordersInterchange)).id

  // The original is delivered with its Business Reference; a Duplicate is never processed.
  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, () => Effect.void)),
    )
  }

  const second = await submitted(ordersInterchange)

  expect(second.status).toBe('duplicate')
  expect(api.runQueue.queued).toEqual([])
  duplicate = second.id
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const detail = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runDetailSchema.parse(response.json())
}

const listed = async (query = '') => {
  const response = await admin.inject({ method: 'GET', url: `${runsEndpoint.path}?${query}` })

  expect(response.statusCode, response.body).toBe(200)

  return runListSchema.parse(response.json())
}

describe('a Duplicate', () => {
  it('links its original Run in the Run detail', async () => {
    await expect(detail(duplicate)).resolves.toMatchObject({
      id: duplicate,
      status: 'duplicate',
      direction: 'inbound',
      failureStage: null,
      problem: null,
      duplicateOf: { id: original },
    })
  })

  it('leaves the original Run without a link', async () => {
    await expect(detail(original)).resolves.toMatchObject({
      status: 'delivered',
      businessReference,
      duplicateOf: null,
    })
  })

  it('shows the Business Reference of its original Run in the Run detail', async () => {
    await expect(detail(duplicate)).resolves.toMatchObject({ businessReference })
  })

  it('shows the Business Reference of its original Run in the Run list', async () => {
    const list = await listed()

    expect(list.runs.map((run) => [run.id, run.businessReference])).toEqual([
      [duplicate, businessReference],
      [original, businessReference],
    ])
  })

  it('is found by the Business Reference of its original Run', async () => {
    const list = await listed('q=12857')

    expect(list.runs.map(({ id }) => id)).toEqual([duplicate, original])
  })

  it('counts Duplicates in the Run list', async () => {
    const list = await listed()

    expect(list.runs.map(({ id }) => id)).toEqual([duplicate, original])
    expect(list.runs[0]).toMatchObject({ status: 'duplicate', failureStage: null, problem: null })
    expect(list).toMatchObject({
      statusCounts: { received: 0, processing: 0, delivered: 1, failed: 0, duplicate: 1 },
      total: 2,
    })
  })

  it('filters the Run list by status duplicate', async () => {
    const list = await listed('status=duplicate')

    expect(list.runs.map(({ id }) => id)).toEqual([duplicate])
    expect(list).toMatchObject({ statusCounts: { delivered: 1, duplicate: 1 }, total: 1 })
  })

  it('leaves Duplicates out of a list filtered by another status', async () => {
    const list = await listed('status=delivered')

    expect(list.runs.map(({ id }) => id)).toEqual([original])
    expect(list.total).toBe(1)
  })
})
