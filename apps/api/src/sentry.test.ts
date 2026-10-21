import * as Sentry from '@sentry/node'
import { Effect } from 'effect'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:os'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  maxDocumentBytes,
  receiveWebhookEndpoint,
  regeneratedWebhookTokenSchema,
  regenerateWebhookTokenEndpoint,
  submitDocumentEndpoint,
  toPath,
  webhookAuthorization,
  webhookTokenHeader,
} from '@edi-bridge/contracts'
import {
  goldenInvoice,
  type InvoiceWorkspace,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { sentryFlushTimeoutMs, sentryOptions, sentryTracer } from './sentry.js'
import {
  addMember,
  signedInClient,
  signInRequest,
  startTestApi,
  type TestApi,
  testRunQueue,
  webOrigin,
} from './testing.js'

const sent: string[][] = []

// Sentry sends an envelope as JSON lines: its header, then a header and a payload per item.
const recordingTransport = (options: Parameters<typeof Sentry.createTransport>[0]) =>
  Sentry.createTransport(options, ({ body }) => {
    sent.push(Buffer.from(body).toString().split('\n'))

    return Promise.resolve({ statusCode: 200 })
  })

const itemHeaderSchema = z.object({ type: z.string() })

const eventSchema = z.looseObject({
  transaction: z.string().optional(),
  breadcrumbs: z.array(z.unknown()).optional(),
  exception: z.object({
    values: z.array(z.looseObject({ type: z.string(), value: z.string().optional() })),
  }),
})

const spansSchema = z.object({
  items: z.array(z.looseObject({ name: z.string(), span_id: z.string(), trace_id: z.string() })),
})

const itemsOf = <T>(type: string, schema: z.ZodType<T>) =>
  sent.flatMap((lines) =>
    lines.flatMap((line, index) =>
      itemHeaderSchema.safeParse(JSON.parse(line || '{}')).data?.type === type
        ? [schema.parse(JSON.parse(lines[index + 1] ?? ''))]
        : [],
    ),
  )

const events = () => itemsOf('event', eventSchema)

const spans = () => itemsOf('span', spansSchema).flatMap(({ items }) => items)

const flushed = async () => {
  await Sentry.flush(sentryFlushTimeoutMs)

  return sent.flat().join('\n')
}

// An envelope quotes a string as JSON, which escapes the quotes and line breaks of a Document.
const expectAbsent = (envelopes: string, secret: string) => {
  expect(envelopes).not.toContain(JSON.stringify(secret).slice(1, -1))
}

const queue = testRunQueue()

let defect: Error | undefined

// Holds a failing receipt back until the test lets it fail.
let defectReleased: Promise<void> = Promise.resolve()

let api: TestApi

let workspace: InvoiceWorkspace

let address: string

let cookie: string

let token: string

beforeAll(async () => {
  Sentry.init({
    ...sentryOptions({
      dsn: 'https://publickey@sentry.example.com/1',
      environment: 'test',
      tracesSampleRate: 1,
    }),
    transport: recordingTransport,
  })

  api = await startTestApi({
    tracer: sentryTracer,
    runQueue: {
      ...queue,
      service: {
        enqueue: (run) => {
          const failure = defect

          return failure === undefined
            ? queue.service.enqueue(run)
            : Effect.promise(() => defectReleased).pipe(Effect.andThen(Effect.die(failure)))
        },
      },
    },
  })
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

  const member = {
    name: 'Nordwind Foods admin',
    email: 'admin@nordwind-foods.example',
    password: 'nordwind-foods-admin-password',
    workspaceId: workspace.id,
    role: 'admin' as const,
  }

  await addMember(api.connection.db, member)

  const signedIn = await api.app.inject(signInRequest(member))

  cookie = signedIn.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')

  const regenerated = await signedInClient(api.app, signedIn).inject({
    method: regenerateWebhookTokenEndpoint.method,
    url: toPath(regenerateWebhookTokenEndpoint.path, { id: workspace.inboundChannelId }),
  })

  token = regeneratedWebhookTokenSchema.parse(regenerated.json()).webhookToken

  // Sentry reads a request as the HTTP server receives it, which an injected request skips.
  address = await api.app.listen({ host: '127.0.0.1', port: 0 })
}, 60_000)

afterAll(async () => {
  await api.stop()
  await Sentry.close()
})

beforeEach(async () => {
  await Sentry.flush(sentryFlushTimeoutMs)
  sent.length = 0
  queue.queued.length = 0
  defect = undefined
  defectReleased = Promise.resolve()
})

const request = (path: string, init: RequestInit) =>
  fetch(new URL(path, address), init).then(({ status }) => status)

const webhookPath = () => toPath(receiveWebhookEndpoint.path, { id: workspace.inboundChannelId })

const postWebhook = (content: string, presented = token, query = '') =>
  request(`${webhookPath()}${query}`, {
    method: receiveWebhookEndpoint.method,
    headers: {
      [webhookTokenHeader]: webhookAuthorization(presented),
      'content-type': 'text/plain',
    },
    body: content,
  })

const asAdmin = (path: string, init: RequestInit = {}) =>
  request(path, {
    ...init,
    headers: { origin: webOrigin, cookie, 'content-type': 'application/json' },
  })

const submit = (content: string, extra: Record<string, string> = {}) =>
  asAdmin(submitDocumentEndpoint.path, {
    method: submitDocumentEndpoint.method,
    body: JSON.stringify({
      channelId: workspace.inboundChannelId,
      document: { fileName: 'invoice.json', content: Buffer.from(content).toString('base64') },
      ...extra,
    }),
  })

describe('the error report of the api', () => {
  it('reports a defect of the webhook route without the Document or the webhook token', async () => {
    defect = new Error('The queue broke')

    expect(await postWebhook(goldenInvoice)).toBe(500)

    const envelopes = await flushed()

    expect(events()).toEqual([
      expect.objectContaining({
        exception: {
          values: [expect.objectContaining({ type: 'Error' })],
        },
      }),
    ])
    expect(spans()).not.toEqual([])
    expectAbsent(envelopes, token)
    expectAbsent(envelopes, goldenInvoice)
  })

  it('reports a defect of a Manual Submission without the request body or the session', async () => {
    const passphrase = `passphrase-${randomUUID()}`

    // Sentry drops an event that repeats the one before it.
    defect = new Error('The queue broke again')

    // No seam fails a Channel route, so this body stands in for a Channel with a passphrase.
    expect(await submit(goldenInvoice, { passphrase })).toBe(500)

    const envelopes = await flushed()

    expect(events()).toHaveLength(1)
    expectAbsent(envelopes, Buffer.from(goldenInvoice).toString('base64'))
    expectAbsent(envelopes, passphrase)

    for (const value of cookie.split('; ').map((pair) => pair.slice(pair.indexOf('=') + 1))) {
      expectAbsent(envelopes, value)
    }
  })

  it('reports a defect without its message or the logs before it, which can quote a secret', async () => {
    // Built at runtime, since the reported stack frames quote the source around them.
    const secret = `credential-${randomUUID()}`

    // A failed query quotes its parameters, and a log line can quote a defect.
    console.error(`Defect with ${secret}`)
    defect = new Error(`Failed query: insert into channels params: ${secret}`)

    expect(await postWebhook(goldenInvoice)).toBe(500)

    const envelopes = await flushed()

    expect(
      events().map(({ exception, breadcrumbs }) => ({
        exceptions: exception.values.map(({ type, value }) => ({ type, value })),
        breadcrumbs: breadcrumbs ?? [],
      })),
    ).toEqual([{ exceptions: [{ type: 'Error', value: 'Error' }], breadcrumbs: [] }])
    expect(spans()).not.toEqual([])
    expect(envelopes).not.toContain('sentry.status.message')
    expectAbsent(envelopes, secret)
  })

  it('reports a defect with the transaction of its own request among concurrent requests', async () => {
    defect = new Error('The queue broke among others')

    let release = () => {}

    defectReleased = new Promise((resolve) => {
      release = resolve
    })

    const failing = postWebhook(goldenInvoice)

    expect(await asAdmin('/runs/not-a-run')).toBe(404)

    release()

    expect(await failing).toBe(500)

    await flushed()

    expect(events().map(({ transaction }) => transaction)).toEqual([
      `${receiveWebhookEndpoint.method} ${receiveWebhookEndpoint.path}`,
    ])
  })

  it('reports a system error without its path, which can name the file of a Trading Partner', async () => {
    const path = `/sftp/inbox/partner-${randomUUID()}.edi`

    defect = Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
      errno: -constants.errno.ENOENT,
      code: 'ENOENT',
      syscall: 'open',
      path,
    })

    expect(await postWebhook(goldenInvoice)).toBe(500)

    const envelopes = await flushed()

    expect(events()).toHaveLength(1)
    expect(envelopes).not.toContain('node_system_error')
    expectAbsent(envelopes, path)
  })

  it('reports no query string of a request URL, which can carry a token', async () => {
    const secret = `token-${randomUUID()}`

    defect = new Error('The queue broke with a query')

    expect(await postWebhook(goldenInvoice, token, `?token=${secret}`)).toBe(500)

    defect = undefined

    expect(await asAdmin(`/auth/get-session?token=${secret}`)).toBe(200)

    const envelopes = await flushed()

    expect(events()).toHaveLength(1)
    expect(spans()).not.toEqual([])
    expectAbsent(envelopes, secret)
  })

  it('reports no expected failure', async () => {
    const statuses = await Promise.all([
      postWebhook(goldenInvoice, 'wrong-token'),
      postWebhook('x'.repeat(maxDocumentBytes + 1)),
      postWebhook(''),
      submit(''),
      asAdmin('/runs/not-a-run'),
    ])

    expect(statuses).toEqual([401, 413, 400, 400, 404])

    await flushed()

    expect(events()).toEqual([])
  })
})

describe('the trace of a receipt', () => {
  const expectReceiptTraced = () => {
    const { trace } = queue.queued[0] ?? {}

    expect(trace?.sampled).toBe(true)
    expect(spans()).toContainEqual(
      expect.objectContaining({
        name: 'run.receipt',
        trace_id: trace?.traceId,
        span_id: trace?.spanId,
      }),
    )
  }

  it('starts at a webhook request the trace the queued Run carries into the worker', async () => {
    expect(await postWebhook(goldenInvoice)).toBe(201)

    expectAbsent(await flushed(), goldenInvoice)
    expectReceiptTraced()
  })

  it('starts at a Manual Submission the trace the queued Run carries into the worker', async () => {
    expect(await submit(goldenInvoice)).toBe(201)

    expectAbsent(await flushed(), Buffer.from(goldenInvoice).toString('base64'))
    expectReceiptTraced()
  })
})
