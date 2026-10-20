import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createChannelEndpoint,
  createdChannelSchema,
  maxDocumentBytes,
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
  addOrdersFlow,
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

const createWebhookChannel = async (name: string, rateLimitPerMinute: number) => {
  const created = await admin.inject({
    method: createChannelEndpoint.method,
    url: createChannelEndpoint.path,
    body: {
      type: 'webhook',
      direction: 'inbound',
      name,
      tradingPartnerId: null,
      rateLimitPerMinute,
    },
  })

  const { channel, webhookToken } = createdChannelSchema.parse(created.json())

  return { channelId: channel.id, token: webhookToken ?? '' }
}

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

  const unrouted = await createWebhookChannel('Unrouted webhook', 60)

  unroutedChannelId = unrouted.channelId
  unroutedToken = unrouted.token
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(() => {
  api.runQueue.queued.length = 0
})

const withToken = (presented: string) => ({ [webhookTokenHeader]: webhookAuthorization(presented) })

type WebhookRequest = {
  channelId?: string
  headers?: Record<string, string>
  contentType?: string | null
}

const post = (
  content: string | Buffer,
  {
    channelId = workspace.inboundChannelId,
    headers = withToken(token),
    contentType = 'application/json',
  }: WebhookRequest = {},
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
    const response = await post(goldenInvoice)

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
    const response = await post(goldenInvoice, {
      headers: { [webhookTokenHeader]: `bEARER ${token}` },
    })

    expect(response.statusCode, response.body).toBe(201)
  })

  it.each([null, 'text/plain', 'application/octet-stream'])(
    'takes the body as the Document with the content type %s',
    async (contentType) => {
      const response = await post(goldenInvoice, { contentType })

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

    const response = await post(goldenInvoice, options())

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ message: 'Unauthorized' })
    expect(api.runQueue.queued).toEqual([])
    expect(await receivedRuns()).toBe(runsBefore)
    expect(await storedDocuments()).toBe(documentsBefore)
  })

  it('answers 422 as for a Manual Submission when no Flow routes Documents from the Channel', async () => {
    const documentsBefore = await storedDocuments()

    const response = await post(goldenInvoice, {
      channelId: unroutedChannelId,
      headers: withToken(unroutedToken),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'No Flow routes Documents from this Channel' })
    expect(await storedDocuments()).toBe((documentsBefore ?? 0) + 1)
  })

  it('answers 422 as for a Manual Submission when no Flow routes a Message of the Document', async () => {
    const response = await post(golden('orders-reference.edi', 'latin1'), {
      contentType: 'application/edifact',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'No Flow on this Channel routes a Message of this Document',
    })
  })

  it('answers 400 for an empty body', async () => {
    const response = await post('', { contentType: 'text/plain' })

    expect(response.statusCode).toBe(400)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 413 for a body over the maximum Document size', async () => {
    const response = await post(Buffer.alloc(maxDocumentBytes + 1, 'x'), {
      contentType: 'text/plain',
    })

    expect(response.statusCode).toBe(413)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 429 with Retry-After and stores nothing once a Channel is over its rate limit, while another Channel still gets through', async () => {
    const limited = await createWebhookChannel('Limited webhook', 2)
    const toLimited = { channelId: limited.channelId, headers: withToken(limited.token) }

    expect((await post(goldenInvoice, toLimited)).statusCode).toBe(422)
    expect((await post(goldenInvoice, toLimited)).statusCode).toBe(422)

    const documentsBefore = await storedDocuments()

    const rejected = await post(goldenInvoice, toLimited)

    expect(rejected.statusCode).toBe(429)
    expect(rejected.json()).toEqual({ message: 'Too many requests' })
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(Number(rejected.headers['retry-after'])).toBeLessThanOrEqual(60)
    expect(await storedDocuments()).toBe(documentsBefore)

    const other = await post(goldenInvoice)

    expect(other.statusCode, other.body).toBe(201)
  })

  it('does not count a request with a wrong token against the Channel rate limit', async () => {
    const limited = await createWebhookChannel('Guarded webhook', 1)

    const toLimitedWithWrongToken = {
      channelId: limited.channelId,
      headers: withToken(`whk_${'x'.repeat(32)}`),
    }

    expect((await post(goldenInvoice, toLimitedWithWrongToken)).statusCode).toBe(401)
    expect((await post(goldenInvoice, toLimitedWithWrongToken)).statusCode).toBe(401)

    const sender = await post(goldenInvoice, {
      channelId: limited.channelId,
      headers: withToken(limited.token),
    })

    expect(sender.statusCode).toBe(422)
  })
})

describe('POST /webhooks/:id with a Document in an encoding other than UTF-8', () => {
  const ordersInterchange = golden('orders-reference.edi', 'latin1')

  beforeAll(async () => {
    await addOrdersFlow(api.connection.db, workspace, { url: 'http://erp.invalid/' })
  })

  const storedOf = async (response: Awaited<ReturnType<typeof post>>) => {
    expect(response.statusCode, response.body).toBe(201)

    const { documentId } = receiveWebhookEndpoint.response.parse(response.json())

    const [stored] = await api.connection.db
      .select({ content: documents.content, bytes: documents.bytes })
      .from(documents)
      .where(eq(documents.id, documentId))

    return stored
  }

  it('decodes a Document with the charset of its Content-Type', async () => {
    const invoice = goldenInvoice.replace('Rudi R\u00fcssel', 'Rudi R\u00fcssel \u20ac')

    const response = await post(Buffer.from(invoice.replace('\u20ac', '\x80'), 'latin1'), {
      contentType: 'application/json; charset=windows-1252',
    })

    expect(await storedOf(response)).toEqual({ content: invoice, bytes: null })
  })

  it.each([
    ['without a charset', 'application/edifact'],
    ['with a charset other than its UNB names', 'application/edifact; charset=utf-8'],
  ])(
    'decodes an Interchange %s with the character set its UNB names',
    async (_case, contentType) => {
      const response = await post(Buffer.from(ordersInterchange, 'latin1'), { contentType })

      expect(await storedOf(response)).toEqual({ content: ordersInterchange, bytes: null })
    },
  )

  it('keeps the bytes of an Interchange not valid in the character set its UNB names', async () => {
    const bytes = Buffer.from(ordersInterchange.replace('UNOC', 'UNOW'), 'latin1')

    const response = await post(bytes, { contentType: 'application/edifact' })

    expect(await storedOf(response)).toEqual({ content: null, bytes })
    expect(receiveWebhookEndpoint.response.parse(response.json()).runs).toHaveLength(1)
  })

  it.each([
    ['without a charset', 'application/json', 'Byte 574 (0xFC) is not valid utf-8'],
    [
      'with an unknown charset',
      'application/json; charset=klingon',
      'The encoding klingon is unknown',
    ],
  ])(
    'answers 422 and stores nothing for a Document not valid in its encoding %s',
    async (_case, contentType, message) => {
      const documentsBefore = await storedDocuments()

      const response = await post(Buffer.from(goldenInvoice, 'latin1'), { contentType })

      expect(response.statusCode).toBe(422)
      expect(response.json()).toEqual({ message })
      expect(await storedDocuments()).toBe(documentsBefore)
    },
  )
})
