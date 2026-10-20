import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type CharacterEncoding,
  documentUndecodableProblemSchema,
  encodeBase64,
  encodeText,
  type ManualSubmissionInput,
  submitDocumentEndpoint,
} from '@edi-bridge/contracts'

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

const mixed = [
  "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+4712'",
  "UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-3+9'UNT+3+1'",
  "UNH+2+DESADV:D:96A:UN:EAN007'BGM+351+DN-1+9'UNT+3+2'",
  "UNH+3+PRICAT:D:96A:UN:EAN008'BGM+9+PL-1+9'UNT+3+3'",
  "UNZ+3+4712'",
].join('\n')

function documentOf(fileName: string, text: string, encoding?: CharacterEncoding) {
  const content = encodeBase64(encodeText(text, encoding ?? 'utf-8'))

  return { fileName, content, encoding }
}

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

  return submitDocumentEndpoint.response.parse(await response.json())
}

describe('messageTypesOf', () => {
  it('reads the Message Type of every UNH segment', () => {
    expect(messageTypesOf(twoOrders)).toEqual(['ORDERS', 'ORDERS'])
  })

  it('keeps a Message Type that EDI Bridge does not know', () => {
    expect(messageTypesOf(mixed)).toEqual(['ORDERS', 'DESADV', 'PRICAT'])
  })

  it('returns null for a Document that is not EDIFACT', () => {
    expect(messageTypesOf('{"orderNumber": "PO-1"}')).toBeNull()
  })
})

describe('manualSubmissionHandler', () => {
  it('creates one manual Run per Message and adds it to the run store', async () => {
    const runs = use()

    const { runs: created, notRouted } = await submitted({
      channelId: inbox.id,
      document: documentOf('orders.edi', twoOrders),
    })

    expect(created).toHaveLength(2)
    expect(notRouted).toEqual([])

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

    const {
      runs: [run],
    } = await submitted({
      channelId: inbox.id,
      document: documentOf(
        'contrl.edi',
        "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+1'UNH+1+CONTRL:D:3:UN'",
      ),
    })

    const flow = seedFlows.find(
      ({ inboundChannelId, messageType }) =>
        inboundChannelId === inbox.id && messageType === 'CONTRL',
    )!

    expect(run?.flow).toEqual({ id: flow.id, name: flow.name })
  })

  it('reports the Messages without a Flow on the Channel as not routed', async () => {
    const runs = use()

    const { runs: created, notRouted } = await submitted({
      channelId: inbox.id,
      document: documentOf('mixed.edi', mixed),
    })

    expect(created).toEqual([expect.objectContaining({ messageType: 'ORDERS' })])
    expect(notRouted).toEqual([{ messageType: 'DESADV' }, { messageType: 'PRICAT' }])
    expect(runs.all()).toHaveLength(1)
  })

  it('rejects an Interchange when no Message has a Flow on the Channel', async () => {
    const runs = use()

    const response = await submit({
      channelId: inbox.id,
      document: documentOf(
        'pricat.edi',
        "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+1'UNH+1+PRICAT:D:96A:UN'",
      ),
    })

    expect(response.status).toBe(422)
    expect(runs.all()).toHaveLength(0)
  })

  it('fails a Document that is not EDIFACT at parsing on a Trading Partner Channel', async () => {
    use()

    const { runs: created } = await submitted({
      channelId: inbox.id,
      document: documentOf('notes.txt', 'Please ship by Friday.'),
    })

    expect(created).toEqual([
      expect.objectContaining({ status: 'failed', failureStage: 'parse', manualSubmission: true }),
    ])
  })

  it('accepts a JSON Document from the own systems on the ERP webhook', async () => {
    use()

    const { runs: created } = await submitted({
      channelId: erpWebhook.id,
      document: documentOf('desadv.json', '{"deliveryNote": "DN-1"}'),
    })

    expect(created).toEqual([expect.objectContaining({ status: 'delivered', failureStage: null })])
  })

  it('rejects an outbound Channel', async () => {
    use()

    const response = await submit({
      channelId: outbox.id,
      document: documentOf('orders.edi', twoOrders),
    })

    expect(response.status).toBe(422)
  })

  it('rejects an unknown Channel', async () => {
    use()

    const response = await submit({
      channelId: '10000000-0000-4000-8000-0000000000ff',
      document: documentOf('orders.edi', twoOrders),
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
      document: documentOf('orders.edi', twoOrders),
    })

    expect(response.status).toBe(422)
  })

  it('routes a Latin-1 Interchange by the character set its UNB names', async () => {
    use()

    const { runs: created } = await submitted({
      channelId: inbox.id,
      document: documentOf('orders.edi', twoOrders.replace('PO-1', 'Lüneburg'), 'windows-1252'),
    })

    expect(created).toEqual([
      expect.objectContaining({ messageType: 'ORDERS' }),
      expect.objectContaining({ messageType: 'ORDERS' }),
    ])
  })

  it('refuses a Document not valid in its encoding and suggests another one', async () => {
    const runs = use()

    const response = await submit({
      channelId: erpWebhook.id,
      document: {
        ...documentOf('dispatch.csv', 'Käufer;Menge\n', 'windows-1252'),
        encoding: 'utf-8',
      },
    })

    expect(response.status).toBe(422)
    expect(documentUndecodableProblemSchema.parse(await response.json())).toEqual({
      code: 'documentUndecodable',
      encoding: 'utf-8',
      message:
        'Byte 2 (0xE4) is not valid utf-8. Choose another encoding, such as Windows-1252 for a typical German CSV.',
    })
    expect(runs.all()).toHaveLength(0)
  })

  it('refuses a Document without an encoding that is not valid UTF-8', async () => {
    use()

    const { fileName, content } = documentOf('dispatch.csv', 'Käufer;Menge\n', 'windows-1252')
    const response = await submit({ channelId: erpWebhook.id, document: { fileName, content } })

    expect(response.status).toBe(422)
    expect(documentUndecodableProblemSchema.parse(await response.json())).toMatchObject({
      code: 'documentUndecodable',
      encoding: 'utf-8',
    })
  })

  it('refuses an Interchange not valid in its character set without suggesting an encoding', async () => {
    use()

    const response = await submit({
      channelId: inbox.id,
      document: documentOf(
        'orders.edi',
        twoOrders.replace('UNOC', 'UNOA').replace('PO-1', 'Lüneburg'),
        'windows-1252',
      ),
    })

    expect(response.status).toBe(422)
    expect(documentUndecodableProblemSchema.parse(await response.json())).toMatchObject({
      code: 'documentUndecodable',
      encoding: null,
      message: expect.stringMatching(/^Byte \d+ \(0xFC\) is not valid in UNOA \(ASCII\), at .+\.$/),
    })
  })

  it('rejects an empty Document', async () => {
    use()

    const response = await submit({
      channelId: inbox.id,
      document: documentOf('empty.edi', ''),
    })

    expect(response.status).toBe(400)
  })
})
