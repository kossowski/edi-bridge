import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type CharacterEncoding,
  documentUndecodableProblemSchema,
  manualSubmissionSchema,
  runListSchema,
  runsEndpoint,
  submitDocumentEndpoint,
} from '@edi-bridge/contracts'
import { channels, flows, runs } from '@edi-bridge/db'
import {
  golden,
  goldenInvoice,
  type InvoiceWorkspace,
  readRun,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let viewer: Client

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

  const member = (role: 'admin' | 'viewer') => ({
    name: `Nordwind Foods ${role}`,
    email: `${role}@nordwind-foods.example`,
    password: `nordwind-foods-${role}-password`,
    workspaceId: workspace.id,
    role,
  })

  await addMember(api.connection.db, member('admin'))
  await addMember(api.connection.db, member('viewer'))
  admin = await signIn(api.app, member('admin'))
  viewer = await signIn(api.app, member('viewer'))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(() => {
  api.runQueue.queued.length = 0
  api.runQueue.redis.reachable = true
})

const submit = (
  content: string | Buffer,
  {
    channelId = workspace.inboundChannelId,
    as = admin,
    encoding,
  }: { channelId?: string | undefined; as?: Client; encoding?: CharacterEncoding | undefined } = {},
) =>
  as.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId,
      document: {
        fileName: 'invoice.json',
        content: Buffer.from(content).toString('base64'),
        encoding,
      },
    },
  })

const storedContent = async (response: Awaited<ReturnType<typeof submit>>) => {
  const [run] = manualSubmissionSchema.parse(response.json()).runs

  return (await readRun(api.connection.db, run?.id ?? ''))?.document?.content
}

const receivedRuns = async () => {
  const response = await admin.inject({ method: 'GET', url: runsEndpoint.path })

  return runListSchema.parse(response.json()).statusCounts.received
}

const ordersInterchange = golden('orders-reference.edi', 'latin1')

const ordersBytes = Buffer.from(ordersInterchange, 'latin1')

const dispatchCsv = 'Käufer;Warenempfänger;Menge\n4012345000016;4098765000013;12\n'

describe('POST /manual-submissions', () => {
  it('announces the new Run to its Workspace', async () => {
    const response = await submit(goldenInvoice)

    const [run] = manualSubmissionSchema.parse(response.json()).runs

    expect(api.liveEvents.published.filter(({ event }) => event.run.id === run?.id)).toEqual([
      { workspaceId: workspace.id, event: { type: 'run.changed', run } },
    ])
  })

  it('receives the Document as a manual Run on the Flow of the Channel and queues it', async () => {
    const response = await submit(goldenInvoice)

    expect(response.statusCode, response.body).toBe(201)

    const submission = manualSubmissionSchema.parse(response.json())

    expect(submission).toMatchObject({
      runs: [
        {
          status: 'received',
          failureStage: null,
          tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
          messageType: 'INVOIC',
          direction: 'outbound',
          flow: { id: workspace.flowId, name: 'Invoices to Hanse Retail' },
          manualSubmission: true,
          businessReference: null,
          interchange: null,
        },
      ],
      notRouted: [],
    })
    expect(api.runQueue.queued).toEqual([
      { workspaceId: workspace.id, runId: submission.runs[0]?.id },
    ])
  })

  it('decodes a Document in the encoding it names', async () => {
    const response = await submit(Buffer.from(dispatchCsv, 'latin1'), {
      encoding: 'windows-1252',
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(await storedContent(response)).toBe(dispatchCsv)
  })

  it('answers 422 with a problem that suggests another encoding when the bytes are not valid UTF-8 and none is named', async () => {
    const before = await receivedRuns()

    const response = await submit(Buffer.from(dispatchCsv, 'latin1'))

    expect(response.statusCode).toBe(422)
    expect(documentUndecodableProblemSchema.parse(response.json())).toEqual({
      code: 'documentUndecodable',
      encoding: 'utf-8',
      message:
        'Byte 2 (0xE4) is not valid utf-8. Choose another encoding, such as Windows-1252 for a typical German CSV.',
      reason: 'Byte 2 (0xE4) is not valid utf-8',
    })
    expect(await receivedRuns()).toBe(before)
  })

  it('answers 422 with a problem that suggests no encoding when an Interchange is not valid in its character set', async () => {
    const response = await submit(Buffer.from(ordersInterchange.replace('UNOC', 'UNOA'), 'latin1'))

    expect(response.statusCode).toBe(422)
    expect(documentUndecodableProblemSchema.parse(response.json())).toMatchObject({
      code: 'documentUndecodable',
      encoding: null,
      message: expect.stringMatching(/^Byte \d+ \(0xFC\) is not valid in UNOA \(ASCII\), at .+\.$/),
    })
  })

  it.each([
    ['the Channel does not exist', () => crypto.randomUUID(), 'The Channel does not exist'],
    [
      'the Channel is outbound',
      () => workspace.outboundChannelId,
      'A Document can only arrive on an inbound Channel',
    ],
  ])('answers 422 when %s', async (_, channelId, message) => {
    const response = await submit(goldenInvoice, { channelId: channelId() })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message })
  })

  it('answers 422 when no Flow routes Documents from the Channel', async () => {
    const [unrouted] = await api.connection.db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: 'webhook',
        direction: 'inbound',
        name: 'Unrouted webhook',
        rateLimitPerMinute: 60,
        encryptedWebhookToken: 'encrypted',
        webhookTokenLastFour: 'wxyz',
      })
      .returning()

    const response = await submit(goldenInvoice, { channelId: unrouted?.id })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'No Flow routes Documents from this Channel' })
  })

  it('answers 422 when no Flow on the Channel routes a Message of the Document', async () => {
    const response = await submit(ordersBytes)

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'No Flow on this Channel routes a Message of this Document',
    })
  })

  describe('with a second Flow on the Channel', () => {
    const addFlow = async (messageType: 'ORDERS' | 'DESADV', name: string) => {
      const [flow] = await api.connection.db
        .insert(flows)
        .values({
          workspaceId: workspace.id,
          tradingPartnerId: workspace.tradingPartnerId,
          messageType,
          name,
          inboundChannelId: workspace.inboundChannelId,
          destinationChannelId: workspace.outboundChannelId,
          mappingVersionId: workspace.mappingVersionId,
        })
        .returning()

      return flow?.id ?? ''
    }

    const removeFlow = async (id: string) => {
      await api.connection.db.delete(runs).where(eq(runs.flowId, id))
      await api.connection.db.delete(flows).where(eq(flows.id, id))
    }

    it('answers 422 when several outbound Flows could take a Document without Message Types', async () => {
      const flowId = await addFlow('DESADV', 'Despatch advices to Hanse Retail')

      try {
        const response = await submit(goldenInvoice)

        expect(response.statusCode).toBe(422)
        expect(response.json()).toEqual({
          message: 'Several outbound Flows on this Channel could take this Document',
        })
      } finally {
        await removeFlow(flowId)
      }
    })

    it('answers 201 with a queued Run for a Document routed to an inbound Flow', async () => {
      const flowId = await addFlow('ORDERS', 'Orders from Hanse Retail')

      try {
        const response = await submit(ordersBytes)

        expect(response.statusCode, response.body).toBe(201)

        const submission = manualSubmissionSchema.parse(response.json())

        expect(submission).toMatchObject({
          runs: [{ status: 'received', direction: 'inbound', flow: { id: flowId } }],
          notRouted: [],
        })
        expect(api.runQueue.queued).toEqual([
          { workspaceId: workspace.id, runId: submission.runs[0]?.id },
        ])
      } finally {
        await removeFlow(flowId)
      }
    })

    it('decodes an Interchange in the character set its UNB names, whatever encoding is named', async () => {
      const flowId = await addFlow('ORDERS', 'Orders from Hanse Retail')

      try {
        const response = await submit(ordersBytes, { encoding: 'utf-8' })

        expect(response.statusCode, response.body).toBe(201)
        expect(await storedContent(response)).toBe(ordersInterchange)
        expect(ordersInterchange).toContain('Claus Früh')
      } finally {
        await removeFlow(flowId)
      }
    })

    it('logs only a named encoding that disagrees with the UNB of an Interchange', async () => {
      const flowId = await addFlow('ORDERS', 'Orders from Hanse Retail')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        const named = await submit(ordersBytes, { encoding: 'utf-8' })
        const agreeing = await submit(ordersBytes, { encoding: 'windows-1252' })
        const unnamed = await submit(ordersBytes)

        expect([named, agreeing, unnamed].map(({ statusCode }) => statusCode)).toEqual([
          201, 201, 201,
        ])
        expect(
          log.mock.calls.flat().filter((line) => /names the encoding/.test(String(line))),
        ).toEqual([expect.stringContaining('names the encoding utf-8, its UNB UNOC')])
      } finally {
        log.mockRestore()
        await removeFlow(flowId)
      }
    })
  })

  it('answers 201 with the received Runs when the Run queue is unreachable', async () => {
    api.runQueue.redis.reachable = false
    const before = await receivedRuns()

    const response = await submit(goldenInvoice)

    expect(response.statusCode, response.body).toBe(201)
    expect(manualSubmissionSchema.parse(response.json())).toMatchObject({
      runs: [{ status: 'received', flow: { id: workspace.flowId }, manualSubmission: true }],
      notRouted: [],
    })
    expect(api.runQueue.queued).toEqual([])
    expect(await receivedRuns()).toBe(before + 1)
  })

  it('answers 400 for a body without a Document', async () => {
    const response = await admin.inject({
      method: submitDocumentEndpoint.method,
      url: submitDocumentEndpoint.path,
      body: { channelId: workspace.inboundChannelId },
    })

    expect(response.statusCode).toBe(400)
  })

  it('answers 403 to a Viewer and receives nothing', async () => {
    const before = await receivedRuns()

    const response = await submit(goldenInvoice, { as: viewer })

    expect(response.statusCode).toBe(403)
    expect(await receivedRuns()).toBe(before)
  })
})
