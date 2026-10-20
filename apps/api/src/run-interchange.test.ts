import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DeliveryFailed } from '@edi-bridge/channels'
import {
  interchangeEndpoint,
  manualSubmissionSchema,
  receiveWebhookEndpoint,
  regeneratedWebhookTokenSchema,
  regenerateWebhookTokenEndpoint,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  submitDocumentEndpoint,
  toPath,
  webhookAuthorization,
  webhookTokenHeader,
} from '@edi-bridge/contracts'
import { runs } from '@edi-bridge/db'
import { type DeliveryService, deliveryInputSchema, processRun } from '@edi-bridge/pipeline'
import {
  addOrdersFlow,
  golden,
  goldenInvoice,
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

const processQueued = async (delivery?: DeliveryService) => {
  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, delivery)),
    )
  }
}

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

  await processQueued(() => Effect.void)

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

  it('has no test indicator once its Document expired', async () => {
    const { runId } = await received(
      Buffer.from(
        ordersWith('EXPIRED1', (header) => `${header}++++++1`),
        'latin1',
      ),
    )

    await api.connection.db
      .update(runs)
      .set({ documentId: null, documentDeletedAt: new Date() })
      .where(eq(runs.id, runId))

    await expect(detail(runId)).resolves.toMatchObject({ testIndicator: null })
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

describe('an outbound Run', () => {
  const unreachable: DeliveryService = () =>
    Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))

  const submitted = async (delivery: DeliveryService, content = goldenInvoice) => {
    const response = await admin.inject({
      method: submitDocumentEndpoint.method,
      url: submitDocumentEndpoint.path,
      body: {
        channelId: workspace.inboundChannelId,
        document: submittedDocument('invoice.json', content),
      },
    })

    expect(response.statusCode, response.body).toBe(201)

    const runId = manualSubmissionSchema.parse(response.json()).runs[0]?.id ?? ''

    await processQueued(delivery)

    return runId
  }

  it('shows the Interchange and Message it built, though the Channel never took them', async () => {
    const runId = await submitted(unreachable)

    const run = await detail(runId)
    const unbSegment: unknown = expect.stringMatching(/^UNB\+/u)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      interchange: { id: runId, raw: unbSegment },
    })
    expect(run.message).toMatchObject({ messageType: 'INVOIC' })
  })
  const invoiceNumber = 'INV-'.repeat(10)

  const invalidInvoice = JSON.stringify({
    ...z.looseObject({}).parse(JSON.parse(goldenInvoice)),
    invoiceNumber,
  })

  const deliveryInputOf = async (runId: string) => {
    const [run] = await api.connection.db
      .select({ deliveryInput: runs.deliveryInput })
      .from(runs)
      .where(eq(runs.id, runId))

    return deliveryInputSchema.parse(run?.deliveryInput)
  }

  // The Message the pipeline builds for the invalid invoice: the golden one with its long BGM number.
  const builtInvalidMessage = async () => {
    const message = await deliveryInputOf(await submitted(unreachable))

    return {
      ...message,
      segments: message.segments.map((segment) =>
        segment.tag === 'BGM'
          ? { ...segment, elements: segment.elements.with(1, [invoiceNumber]) }
          : segment,
      ),
    }
  }

  it('shows the Message it built at the failing position when validation failed', async () => {
    const message = await builtInvalidMessage()
    const runId = await submitted(unreachable, invalidInvoice)

    await api.connection.db.update(runs).set({ deliveryInput: message }).where(eq(runs.id, runId))

    const run = await detail(runId)
    const position = run.error?.position

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      interchange: null,
      error: { code: 'too-long-element', position: { segment: 2, tag: 'BGM', element: 2 } },
    })
    expect(run.message).toMatchObject({ reference: message.header.elements[0]?.[0] })
    expect(run.message?.segments[0]).toMatchObject({ tag: 'UNH', name: 'Message header' })
    expect(run.message?.segments[(position?.segment ?? 0) - 1]).toEqual({
      tag: 'BGM',
      name: 'Beginning of message',
      elements: [['380'], [invoiceNumber], ['9']],
    })
    expect(run.message?.segments).toHaveLength(message.segments.length + 2)
  })

  it('shows the Message it built when delivery failed before the Interchange was built', async () => {
    const runId = await submitted(unreachable)
    const message = await deliveryInputOf(runId)

    // A delivery that fails before the envelope, for a missing GLN, stores no Interchange.
    await api.connection.db.update(runs).set({ output: null }).where(eq(runs.id, runId))

    const run = await detail(runId)

    expect(run).toMatchObject({ status: 'failed', failureStage: 'delivery', interchange: null })
    expect(run.message).toMatchObject({ messageType: 'INVOIC' })
    expect(run.message?.segments.map(({ tag }) => tag)).toEqual([
      message.header.tag,
      ...message.segments.map(({ tag }) => tag),
      message.trailer.tag,
    ])
  })

  it('has no Message when mapping failed, and its error says why', async () => {
    const runId = await submitted(unreachable, 'not json')

    await expect(detail(runId)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      interchange: null,
      message: null,
      error: { message: expect.any(String) },
    })
  })
})
