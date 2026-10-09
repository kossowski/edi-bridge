import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { type ManualSubmissionInput, submitDocumentEndpoint } from '@edi-bridge/contracts'

import { seedChannels } from './channel'
import { createFlowStore, seedFlows } from './flow'
import { manualSubmissionHandler, messageTypesOf } from './manual-submission'
import { createRunStore } from './run-store'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

function channelNamed(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const inbox = channelNamed('Hansemarkt SFTP inbox')

const outbox = channelNamed('Hansemarkt SFTP outbox')

const erpWebhook = channelNamed('ERP webhook')

const twoOrders = [
  "UNA:+.? 'UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+4711'",
  "UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-1+9'UNT+3+1'",
  "UNH+2+ORDERS:D:96A:UN:EAN008'BGM+220+PO-2+9'UNT+3+2'",
  "UNZ+2+4711'",
].join('\n')

function use(runs = createRunStore([])) {
  server.use(manualSubmissionHandler(apiUrl, { runs, flows: createFlowStore() }))

  return runs
}

async function submit(body: Partial<ManualSubmissionInput>) {
  return fetch(`${apiUrl}${submitDocumentEndpoint.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function submitted(body: ManualSubmissionInput) {
  const response = await submit(body)

  expect(response.status).toBe(201)

  return submitDocumentEndpoint.response.parse(await response.json()).runs
}

describe('messageTypesOf', () => {
  it('reads the Message Type of every UNH segment', () => {
    expect(messageTypesOf(twoOrders)).toEqual(['ORDERS', 'ORDERS'])
  })

  it('returns null for a Document that is not EDIFACT', () => {
    expect(messageTypesOf('{"orderNumber": "PO-1"}')).toBeNull()
  })
})

describe('manualSubmissionHandler', () => {
  it('creates one manual Run per Message and adds it to the run store', async () => {
    const runs = use()

    const created = await submitted({
      channelId: inbox.id,
      document: { fileName: 'orders.edi', content: twoOrders },
    })

    expect(created).toHaveLength(2)

    for (const run of created) {
      expect(run).toMatchObject({
        manualSubmission: true,
        status: 'delivered',
        messageType: 'ORDERS',
        tradingPartner: { id: inbox.tradingPartnerId },
      })
      expect(runs.get(run.id)).toEqual(run)
    }
  })

  it('routes each Message to the Flow for its Message Type', async () => {
    use()

    const [run] = await submitted({
      channelId: inbox.id,
      document: {
        fileName: 'contrl.edi',
        content: "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+1'UNH+1+CONTRL:D:3:UN'",
      },
    })

    const flow = seedFlows.find(
      ({ inboundChannelId, messageType }) =>
        inboundChannelId === inbox.id && messageType === 'CONTRL',
    )!

    expect(run?.flow).toEqual({ id: flow.id, name: flow.name })
  })

  it('fails a Document that is not EDIFACT at parsing on a Trading Partner Channel', async () => {
    use()

    const created = await submitted({
      channelId: inbox.id,
      document: { fileName: 'notes.txt', content: 'Please ship by Friday.' },
    })

    expect(created).toEqual([
      expect.objectContaining({ status: 'failed', failureStage: 'parse', manualSubmission: true }),
    ])
  })

  it('accepts a JSON Document from the own systems on the ERP webhook', async () => {
    use()

    const created = await submitted({
      channelId: erpWebhook.id,
      document: { fileName: 'desadv.json', content: '{"deliveryNote": "DN-1"}' },
    })

    expect(created).toEqual([expect.objectContaining({ status: 'delivered', failureStage: null })])
  })

  it('rejects an outbound Channel', async () => {
    use()

    const response = await submit({
      channelId: outbox.id,
      document: { fileName: 'orders.edi', content: twoOrders },
    })

    expect(response.status).toBe(422)
  })

  it('rejects an unknown Channel', async () => {
    use()

    const response = await submit({
      channelId: '10000000-0000-4000-8000-0000000000ff',
      document: { fileName: 'orders.edi', content: twoOrders },
    })

    expect(response.status).toBe(422)
  })

  it('rejects an inbound Channel that no Flow routes from', async () => {
    server.use(
      manualSubmissionHandler(apiUrl, {
        flows: createFlowStore(
          seedFlows.filter(({ inboundChannelId }) => inboundChannelId !== inbox.id),
        ),
      }),
    )

    const response = await submit({
      channelId: inbox.id,
      document: { fileName: 'orders.edi', content: twoOrders },
    })

    expect(response.status).toBe(422)
  })

  it('rejects an empty Document', async () => {
    use()

    const response = await submit({
      channelId: inbox.id,
      document: { fileName: 'empty.edi', content: '' },
    })

    expect(response.status).toBe(400)
  })
})
