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
import {
  addOrdersFlow,
  golden,
  type InvoiceWorkspace,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

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
      document: { fileName: 'orders.edi', content },
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  const [run] = manualSubmissionSchema.parse(response.json()).runs

  if (!run) {
    throw new Error('The submission created no Run')
  }

  return run
}

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

  const resent = await submitted(ordersInterchange)

  expect(resent.status).toBe('duplicate')
  duplicate = resent.id
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
      status: 'received',
      duplicateOf: null,
    })
  })

  it('counts Duplicates in the Run list', async () => {
    const list = await listed()

    expect(list.runs.map(({ id }) => id)).toEqual([duplicate, original])
    expect(list.runs[0]).toMatchObject({ status: 'duplicate', failureStage: null, problem: null })
    expect(list).toMatchObject({
      statusCounts: { received: 1, processing: 0, delivered: 0, failed: 0, duplicate: 1 },
      total: 2,
    })
  })

  it('filters the Run list by status duplicate', async () => {
    const list = await listed('status=duplicate')

    expect(list.runs.map(({ id }) => id)).toEqual([duplicate])
    expect(list).toMatchObject({ statusCounts: { received: 1, duplicate: 1 }, total: 1 })
  })

  it('leaves Duplicates out of a list filtered by another status', async () => {
    const list = await listed('status=received')

    expect(list.runs.map(({ id }) => id)).toEqual([original])
    expect(list.total).toBe(1)
  })
})
