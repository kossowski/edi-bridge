import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  interchangeEndpoint,
  receiveWebhookEndpoint,
  regeneratedWebhookTokenSchema,
  regenerateWebhookTokenEndpoint,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  toPath,
  webhookAuthorization,
  webhookTokenHeader,
} from '@edi-bridge/contracts'
import { processRun } from '@edi-bridge/pipeline'
import {
  addOrdersFlow,
  golden,
  type InvoiceWorkspace,
  pipelineServices,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let token: string

const ordersInterchange = golden('orders-reference.edi', 'latin1')

// Each Interchange gets its own control reference, so none is a Duplicate of another.
const ordersWith = (controlReference: string, unb = (header: string) => header) =>
  ordersInterchange
    .replace("+00000001'", `+${controlReference}'`)
    .replace(/^UNB[^']*/u, unb)
    .replace("UNZ+1+00000001'", `UNZ+1+${controlReference}'`)

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

  const regenerated = await admin.inject({
    method: regenerateWebhookTokenEndpoint.method,
    url: toPath(regenerateWebhookTokenEndpoint.path, { id: workspace.inboundChannelId }),
  })

  token = regeneratedWebhookTokenSchema.parse(regenerated.json()).webhookToken
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const received = async (bytes: Buffer) => {
  const response = await api.app.inject({
    method: receiveWebhookEndpoint.method,
    url: toPath(receiveWebhookEndpoint.path, { id: workspace.inboundChannelId }),
    headers: {
      'content-type': 'application/edifact',
      [webhookTokenHeader]: webhookAuthorization(token),
    },
    body: bytes,
  })

  expect(response.statusCode, response.body).toBe(201)

  const { documentId, runs } = receiveWebhookEndpoint.response.parse(response.json())
  const [run] = runs

  if (run === undefined) {
    throw new Error('The webhook created no Run')
  }

  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, () => Effect.void)),
    )
  }

  return { documentId, runId: run.id }
}

const detail = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runEndpoint.response.parse(response.json())
}

describe('an inbound Run', () => {
  it('lists the Interchange of its Document in the Run list', async () => {
    const { documentId, runId } = await received(Buffer.from(ordersWith('LIST1'), 'latin1'))

    const response = await admin.inject({ method: 'GET', url: runsEndpoint.path })
    const { runs } = runListSchema.parse(response.json())

    expect(runs.find(({ id }) => id === runId)?.interchange).toEqual({
      id: documentId,
      controlReference: 'LIST1',
    })
  })

  it('shows its raw Interchange and its parsed Message in the Run detail', async () => {
    const orders = ordersWith('DETAIL1')
    const { documentId, runId } = await received(Buffer.from(orders, 'latin1'))

    const run = await detail(runId)

    expect(run).toMatchObject({
      status: 'delivered',
      interchange: { id: documentId, controlReference: 'DETAIL1', raw: orders },
      testIndicator: false,
    })
    expect(run.message).toMatchObject({ reference: 'ME0001', messageType: 'ORDERS' })
    expect(run.message?.segments).toHaveLength(22)
    expect(run.message?.segments[0]).toEqual({
      tag: 'UNH',
      name: 'Message header',
      elements: [['ME0001'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']],
    })
    expect(run.message?.segments[5]).toEqual({
      tag: 'CTA',
      name: 'Contact information',
      elements: [['OC'], ['Claus Früh']],
    })
  })

  it('carries the test indicator of its Interchange', async () => {
    const { runId } = await received(
      Buffer.from(
        ordersWith('TEST1', (header) => `${header}++++++1`),
        'latin1',
      ),
    )

    await expect(detail(runId)).resolves.toMatchObject({ testIndicator: true })
  })

  it('shows the readable text of an Interchange kept as bytes, without a Message', async () => {
    const orders = ordersWith('BYTES1', (header) => header.replace('UNOC', 'UNOW'))
    const { documentId, runId } = await received(Buffer.from(orders, 'latin1'))

    // Each Latin-1 umlaut is a byte that UTF-8 does not read.
    const readable = orders.replaceAll(/[\u0080-\u00ff]/gu, '�')

    await expect(detail(runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'parse',
      interchange: { id: documentId, controlReference: 'BYTES1', raw: readable },
      message: null,
    })

    const interchange = await admin.inject({
      method: interchangeEndpoint.method,
      url: toPath(interchangeEndpoint.path, { id: documentId }),
    })

    expect(interchange.statusCode, interchange.body).toBe(200)
    expect(interchangeEndpoint.response.parse(interchange.json())).toMatchObject({
      raw: readable,
    })
  })
})
