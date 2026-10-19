import { count } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createChannelEndpoint,
  createdChannelSchema,
  maxDocumentLength,
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
import { documents } from '@edi-bridge/db'
import {
  golden,
  goldenInvoice,
  type InvoiceWorkspace,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let token: string

let unroutedChannelId: string

let unroutedToken: string

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

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

  const created = await admin.inject({
    method: createChannelEndpoint.method,
    url: createChannelEndpoint.path,
    body: {
      type: 'webhook',
      direction: 'inbound',
      name: 'Unrouted webhook',
      tradingPartnerId: null,
      rateLimitPerMinute: 60,
    },
  })

  const { channel, webhookToken } = createdChannelSchema.parse(created.json())

  unroutedChannelId = channel.id
  unroutedToken = webhookToken ?? ''
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(() => {
  api.runQueue.queued.length = 0
})

const withToken = (presented: string) => ({ [webhookTokenHeader]: webhookAuthorization(presented) })

type Delivery = {
  channelId?: string
  headers?: Record<string, string>
  contentType?: string | null
}

const deliver = (
  content: string | Buffer,
  {
    channelId = workspace.inboundChannelId,
    headers = withToken(token),
    contentType = 'application/json',
  }: Delivery = {},
) =>
  api.app.inject({
    method: receiveWebhookEndpoint.method,
    url: toPath(receiveWebhookEndpoint.path, { id: channelId }),
    headers: { ...(contentType !== null && { 'content-type': contentType }), ...headers },
    body: content,
  })

const receivedRuns = async () => {
  const response = await admin.inject({ method: 'GET', url: runsEndpoint.path })

  return runListSchema.parse(response.json()).statusCounts.received
}

const storedDocuments = async () => {
  const [row] = await api.connection.db.select({ stored: count() }).from(documents)

  return row?.stored
}

describe('POST /webhooks/:id', () => {
  it('receives a Document with a valid token as a Run that is not manual and queues it', async () => {
    const response = await deliver(goldenInvoice)

    expect(response.statusCode, response.body).toBe(201)

    const receipt = receiveWebhookEndpoint.response.parse(response.json())

    expect(receipt.runs).toHaveLength(1)
    expect(receipt.notRouted).toEqual([])
    expect(api.runQueue.queued).toEqual([{ workspaceId: workspace.id, runId: receipt.runs[0]?.id }])

    const run = await admin.inject({
      method: 'GET',
      url: toPath(runEndpoint.path, { id: receipt.runs[0]?.id ?? '' }),
    })

    expect(runEndpoint.response.parse(run.json())).toMatchObject({
      manualSubmission: false,
      flow: { id: workspace.flowId },
    })
  })

  it('takes the Bearer scheme in any letter case', async () => {
    const response = await deliver(goldenInvoice, {
      headers: { [webhookTokenHeader]: `bEARER ${token}` },
    })

    expect(response.statusCode, response.body).toBe(201)
  })

  it.each([null, 'text/plain', 'application/octet-stream'])(
    'takes the body as the Document with the content type %s',
    async (contentType) => {
      const response = await deliver(goldenInvoice, { contentType })

      expect(response.statusCode, response.body).toBe(201)
      expect(receiveWebhookEndpoint.response.parse(response.json()).runs).toHaveLength(1)
    },
  )

  it.each([
    ['the token is missing', () => ({ headers: {} })],
    ['the token is wrong', () => ({ headers: withToken(`whk_${'x'.repeat(32)}`) })],
    ['the token is not a bearer token', () => ({ headers: { [webhookTokenHeader]: token } })],
    ['the token belongs to another Channel', () => ({ headers: withToken(unroutedToken) })],
    ['the Channel does not exist', () => ({ channelId: crypto.randomUUID() })],
    ['the Channel id is not an id', () => ({ channelId: 'not-a-channel-id' })],
    ['the Channel is not a webhook', () => ({ channelId: workspace.outboundChannelId })],
  ])('answers 401 and stores nothing when %s', async (_, options) => {
    const runsBefore = await receivedRuns()
    const documentsBefore = await storedDocuments()

    const response = await deliver(goldenInvoice, options())

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ message: 'Unauthorized' })
    expect(api.runQueue.queued).toEqual([])
    expect(await receivedRuns()).toBe(runsBefore)
    expect(await storedDocuments()).toBe(documentsBefore)
  })

  it('answers 422 as for a Manual Submission when no Flow routes Documents from the Channel', async () => {
    const documentsBefore = await storedDocuments()

    const response = await deliver(goldenInvoice, {
      channelId: unroutedChannelId,
      headers: withToken(unroutedToken),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'No Flow routes Documents from this Channel' })
    expect(await storedDocuments()).toBe((documentsBefore ?? 0) + 1)
  })

  it('answers 422 as for a Manual Submission when no Flow routes a Message of the Document', async () => {
    const response = await deliver(golden('orders-reference.edi', 'latin1'), {
      contentType: 'application/edifact',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'No Flow on this Channel routes a Message of this Document',
    })
  })

  it('answers 400 for an empty body', async () => {
    const response = await deliver('', { contentType: 'text/plain' })

    expect(response.statusCode).toBe(400)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 400 for a body over the maximum Document length', async () => {
    const response = await deliver('x'.repeat(maxDocumentLength + 1), { contentType: 'text/plain' })

    expect(response.statusCode).toBe(400)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 413 for a body over the largest Document in UTF-8', async () => {
    const response = await deliver(Buffer.alloc(3 * maxDocumentLength + 1, 'x'), {
      contentType: 'text/plain',
    })

    expect(response.statusCode).toBe(413)
    expect(api.runQueue.queued).toEqual([])
  })
})
