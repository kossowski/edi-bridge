import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  interchangeEndpoint,
  interchangeSchema,
  type InterchangeListQuery,
  interchangeListSchema,
  interchangesEndpoint,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'
import { documents, flows, runs, tradingPartners } from '@edi-bridge/db'
import { type InvoiceWorkspace, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { hourMs } from './duration.js'
import { addMember, type Client, one, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

const workspaceGln = '4389876511114'

const now = Date.now()

const hoursAgo = (hours: number) => new Date(now - hours * hourMs)

const interchangeOf = (
  sender: string,
  receiver: string,
  controlReference: string,
  messages: ReadonlyArray<{ reference: string; messageType: string }>,
) =>
  [
    `UNB+UNOC:3+${sender}:14+${receiver}:14+261020:0800+${controlReference}'`,
    ...messages.flatMap(({ reference, messageType }) => [
      `UNH+${reference}+${messageType}:D:96A:UN:EAN008'`,
      `BGM+220+${reference}+9'`,
      `UNT+3+${reference}'`,
    ]),
    `UNZ+${String(messages.length)}+${controlReference}'`,
  ].join('\n')

async function addTradingPartner(target: InvoiceWorkspace, name: string, gln: string) {
  const db = api.connection.db

  const tradingPartner = await one(
    db
      .insert(tradingPartners)
      .values({
        workspaceId: target.id,
        name,
        gln,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      })
      .returning(),
  )

  const flowOf = (messageType: 'ORDERS' | 'INVOIC') =>
    one(
      db
        .insert(flows)
        .values({
          workspaceId: target.id,
          tradingPartnerId: tradingPartner.id,
          messageType,
          name: `${name} ${messageType}`,
          inboundChannelId: target.inboundChannelId,
          destinationChannelId: target.outboundChannelId,
          mappingVersionId: target.mappingVersionId,
        })
        .returning(),
    )

  const orders = await flowOf('ORDERS')
  const invoic = await flowOf('INVOIC')

  const storeDocument = (values: Partial<typeof documents.$inferInsert> & { content: string }) =>
    one(
      db
        .insert(documents)
        .values({
          workspaceId: target.id,
          channelId: target.inboundChannelId,
          fileName: 'document.edi',
          ...values,
        })
        .returning(),
    )

  const addRun = async ({
    documentId,
    ...values
  }: Omit<typeof runs.$inferInsert, 'workspaceId' | 'tradingPartnerId' | 'manualSubmission'>) =>
    one(
      db
        .insert(runs)
        .values({
          workspaceId: target.id,
          tradingPartnerId: tradingPartner.id,
          manualSubmission: false,
          documentId: documentId ?? (await storeDocument({ content: '{}' })).id,
          ...values,
        })
        .returning(),
    )

  const sendInvoice = async ({
    controlReference,
    handedOverAt,
    businessReference = null,
  }: {
    controlReference: number
    handedOverAt: Date
    businessReference?: string | null
  }) => {
    return addRun({
      flowId: invoic.id,
      status: 'delivered',
      businessReference,
      output: interchangeOf(workspaceGln, gln, String(controlReference), [
        { reference: '1', messageType: 'INVOIC' },
      ]),
      handedOverAt,
      controlReference,
      receivedAt: handedOverAt,
    })
  }

  const receiveOrders = async ({
    controlReference,
    receivedAt,
    businessReferences,
  }: {
    controlReference: string
    receivedAt: Date
    businessReferences: readonly string[]
  }) => {
    const document = await storeDocument({
      content: interchangeOf(
        gln,
        workspaceGln,
        controlReference,
        businessReferences.map((reference) => ({ reference, messageType: 'ORDERS' })),
      ),
      interchangeSender: gln,
      interchangeControlReference: controlReference,
      receivedAt,
    })

    const received = []

    for (const [index, reference] of businessReferences.entries()) {
      received.push(
        await addRun({
          documentId: document.id,
          flowId: orders.id,
          status: 'delivered',
          businessReference: reference,
          messageIndex: index + 1,
          receivedAt,
        }),
      )
    }

    return { document, runs: received }
  }

  return {
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    receiveOrders,
    orders,
    invoic,
    storeDocument,
    addRun,
    sendInvoice,
  }
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
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listed = async (query: Partial<InterchangeListQuery> = {}, as = admin) => {
  const search = toSearchParams(query).toString()

  const response = await as.inject({
    method: interchangesEndpoint.method,
    url: search === '' ? interchangesEndpoint.path : `${interchangesEndpoint.path}?${search}`,
  })

  expect(response.statusCode).toBe(200)

  return interchangeListSchema.parse(response.json())
}

describe('GET /interchanges', () => {
  it('lists a handed-over outbound Run as its own Interchange, named by the Run id', async () => {
    const partner = await addTradingPartner(workspace, 'Rheinkauf eG', '4012345000016')

    const invoice = await partner.sendInvoice({
      controlReference: 4711,
      handedOverAt: hoursAgo(1),
      businessReference: '87441',
    })

    await partner.addRun({
      flowId: partner.invoic.id,
      status: 'processing',
      receivedAt: hoursAgo(0.5),
    })

    const { interchanges } = await listed({ tradingPartnerId: [partner.tradingPartner.id] })

    expect(interchanges).toEqual([
      {
        id: invoice.id,
        controlReference: '4711',
        direction: 'outbound',
        tradingPartner: partner.tradingPartner,
        preparedAt: hoursAgo(1).toISOString(),
        runs: [
          expect.objectContaining({
            id: invoice.id,
            messageType: 'INVOIC',
            status: 'delivered',
            businessReference: '87441',
            interchange: { id: invoice.id, controlReference: '4711' },
          }),
        ],
      },
    ])
  })

  it('bundles the Runs of a received Interchange under its Document, newest Interchange first', async () => {
    const partner = await addTradingPartner(workspace, 'Elbmarkt KG', '4012345000023')

    const older = await partner.sendInvoice({ controlReference: 12, handedOverAt: hoursAgo(3) })

    const received = await partner.receiveOrders({
      controlReference: 'ORD0815',
      receivedAt: hoursAgo(2),
      businessReferences: ['PO-1', 'PO-2'],
    })

    const [firstRun, secondRun] = received.runs

    const reprocessed = await partner.addRun({
      documentId: received.document.id,
      flowId: partner.orders.id,
      status: 'delivered',
      messageIndex: 1,
      replacesRunId: firstRun!.id,
      receivedAt: hoursAgo(1),
    })

    await partner.addRun({
      flowId: partner.orders.id,
      status: 'delivered',
      receivedAt: hoursAgo(1),
    })

    const { interchanges, total } = await listed({ tradingPartnerId: [partner.tradingPartner.id] })

    expect(total).toBe(2)
    expect(
      interchanges.map(({ id, direction, controlReference, preparedAt }) => ({
        id,
        direction,
        controlReference,
        preparedAt,
      })),
    ).toEqual([
      {
        id: received.document.id,
        direction: 'inbound',
        controlReference: 'ORD0815',
        preparedAt: hoursAgo(2).toISOString(),
      },
      {
        id: older.id,
        direction: 'outbound',
        controlReference: '12',
        preparedAt: hoursAgo(3).toISOString(),
      },
    ])
    expect(interchanges[0]?.runs.map(({ id, interchange }) => ({ id, interchange }))).toEqual(
      [firstRun!.id, secondRun!.id, reprocessed.id].map((id) => ({
        id,
        interchange: { id: received.document.id, controlReference: 'ORD0815' },
      })),
    )
  })

  it('searches the control reference, the Trading Partner and the Business Reference, ignoring case', async () => {
    const partner = await addTradingPartner(workspace, 'Moselhandel AG', '4012345000030')

    const invoice = await partner.sendInvoice({
      controlReference: 90_210,
      handedOverAt: hoursAgo(4),
      businessReference: 'INV-7731',
    })

    const received = await partner.receiveOrders({
      controlReference: 'MOS4400',
      receivedAt: hoursAgo(5),
      businessReferences: ['PO-5531'],
    })

    const idsFor = async (query: Partial<InterchangeListQuery>) =>
      (await listed(query)).interchanges.map(({ id }) => id)

    expect(await idsFor({ q: 'inv-77' })).toEqual([invoice.id])
    expect(await idsFor({ q: 'mos44' })).toEqual([received.document.id])
    expect(await idsFor({ q: '90210' })).toEqual([invoice.id])
    expect(await idsFor({ q: 'MOSELHANDEL' })).toEqual([invoice.id, received.document.id])
    expect(await idsFor({ q: 'moselhandel', messageType: ['ORDERS'] })).toEqual([
      received.document.id,
    ])
  })

  it('filters by the message type of the Runs', async () => {
    const partner = await addTradingPartner(workspace, 'Ilmtaler Markt eG', '4012345000085')

    const invoice = await partner.sendInvoice({ controlReference: 640, handedOverAt: hoursAgo(9) })

    const received = await partner.receiveOrders({
      controlReference: 'ILM640',
      receivedAt: hoursAgo(10),
      businessReferences: ['PO-640'],
    })

    const idsFor = async (messageType: InterchangeListQuery['messageType']) =>
      (
        await listed({ tradingPartnerId: [partner.tradingPartner.id], messageType })
      ).interchanges.map(({ id }) => id)

    expect(await idsFor(['INVOIC'])).toEqual([invoice.id])
    expect(await idsFor(['ORDERS'])).toEqual([received.document.id])
    expect(await idsFor(['INVOIC', 'ORDERS'])).toEqual([invoice.id, received.document.id])
  })

  it('serves one page at a time and leaves out the Interchanges of other Workspaces', async () => {
    const partner = await addTradingPartner(workspace, 'Saalekontor GmbH', '4012345000047')

    for (const hours of [6, 7, 8]) {
      await partner.sendInvoice({ controlReference: 300 + hours, handedOverAt: hoursAgo(hours) })
    }

    const other = await seedInvoiceWorkspace(api.connection.db, 'Saalefood')
    const outsider = await addTradingPartner(other, 'Saalekontor GmbH', '4012345000047')
    await outsider.sendInvoice({ controlReference: 399, handedOverAt: hoursAgo(6.5) })

    const page = await listed({ q: 'saalekontor', page: 2, pageSize: 2 })

    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 })
    expect(page.interchanges.map(({ controlReference }) => controlReference)).toEqual(['308'])
  })
})

const loaded = async (id: string, as = admin) =>
  as.inject({
    method: interchangeEndpoint.method,
    url: toPath(interchangeEndpoint.path, { id }),
  })

describe('GET /interchanges/:id', () => {
  it('shows a sent Interchange with its parties, raw text and Run', async () => {
    const partner = await addTradingPartner(workspace, 'Weserfrisch eG', '4012345000054')
    const invoice = await partner.sendInvoice({ controlReference: 515, handedOverAt: hoursAgo(1) })

    const response = await loaded(invoice.id)

    expect(response.statusCode).toBe(200)
    expect(interchangeSchema.parse(response.json())).toEqual({
      id: invoice.id,
      controlReference: '515',
      direction: 'outbound',
      sender: { identification: workspaceGln, name: 'Nordwind Foods' },
      receiver: { identification: '4012345000054', name: 'Weserfrisch eG' },
      raw: invoice.output,
      runs: [
        expect.objectContaining({
          id: invoice.id,
          messageReference: '1',
          interchange: { id: invoice.id, controlReference: '515' },
        }),
      ],
    })
  })

  it('shows a received Interchange with the Message reference of each Run', async () => {
    const partner = await addTradingPartner(workspace, 'Ostseekauf GmbH', '4012345000061')

    const received = await partner.receiveOrders({
      controlReference: 'OSK77',
      receivedAt: hoursAgo(2),
      businessReferences: ['PO-71', 'PO-72'],
    })

    const response = await loaded(received.document.id)

    expect(response.statusCode).toBe(200)
    expect(interchangeSchema.parse(response.json())).toMatchObject({
      id: received.document.id,
      controlReference: 'OSK77',
      direction: 'inbound',
      sender: { identification: '4012345000061', name: 'Ostseekauf GmbH' },
      receiver: { identification: workspaceGln, name: 'Nordwind Foods' },
      raw: received.document.content,
    })
    expect(
      interchangeSchema
        .parse(response.json())
        .runs.map(({ id, messageReference }) => ({ id, messageReference })),
    ).toEqual(
      received.runs.map(({ id }, index) => ({ id, messageReference: `PO-7${String(index + 1)}` })),
    )
  })

  it('shows a received Interchange whose envelope breaks after its Messages', async () => {
    const partner = await addTradingPartner(workspace, 'Lahnhof eG', '4012345000092')

    const content = `${interchangeOf('4012345000092', workspaceGln, 'LAH1', [
      { reference: 'PO-91', messageType: 'ORDERS' },
    ])
      .split('\n')
      .slice(0, -1)
      .join('\n')}\nUNH+PO-92+ORDERS:D:96A:UN:EAN008'`

    const document = await partner.storeDocument({
      content,
      interchangeSender: '4012345000092',
      interchangeControlReference: 'LAH1',
    })

    const runIds = []

    for (const messageIndex of [1, 2, 3]) {
      runIds.push(
        (
          await partner.addRun({
            documentId: document.id,
            flowId: partner.orders.id,
            status: 'failed',
            failureStage: 'parse',
            problem: { reason: 'unreadable', fixTarget: null },
            error: {
              code: 'missing-interchange-trailer',
              message: 'No UNZ',
              position: null,
              details: null,
            },
            messageIndex,
          })
        ).id,
      )
    }

    const response = await loaded(document.id)

    expect(response.statusCode, response.body).toBe(200)
    expect(
      interchangeSchema
        .parse(response.json())
        .runs.map(({ id, messageReference }) => ({ id, messageReference })),
    ).toEqual([
      { id: runIds[0], messageReference: 'PO-91' },
      { id: runIds[1], messageReference: 'PO-92' },
      { id: runIds[2], messageReference: null },
    ])
  })

  it('names the parties by the identifications in the UNB, though they are no GLNs', async () => {
    const partner = await addTradingPartner(workspace, 'Rhönmarkt KG', '4012345000108')

    const document = await partner.storeDocument({
      content: interchangeOf('RHOENMARKT', 'NORDWIND-FOODS', 'RHM1', [
        { reference: 'PO-1', messageType: 'ORDERS' },
      ]),
      interchangeSender: 'RHOENMARKT',
      interchangeControlReference: 'RHM1',
    })

    await partner.addRun({
      documentId: document.id,
      flowId: partner.orders.id,
      status: 'delivered',
      messageIndex: 1,
    })

    const response = await loaded(document.id)

    expect(response.statusCode, response.body).toBe(200)
    expect(interchangeSchema.parse(response.json())).toMatchObject({
      sender: { identification: 'RHOENMARKT', name: 'Rhönmarkt KG' },
      receiver: { identification: 'NORDWIND-FOODS', name: 'Nordwind Foods' },
    })
  })

  it('shows a received Interchange whose UNB no longer reads, without its parties', async () => {
    const partner = await addTradingPartner(workspace, 'Moselgut AG', '4012345000115')

    const document = await partner.storeDocument({
      // As read from bytes whose first character is not valid in the named character set.
      content: `\uFFFD${interchangeOf('4012345000115', workspaceGln, 'MOS1', [
        { reference: 'PO-1', messageType: 'ORDERS' },
      ]).slice(1)}`,
      interchangeSender: '4012345000115',
      interchangeControlReference: 'MOS1',
    })

    const run = await partner.addRun({
      documentId: document.id,
      flowId: partner.orders.id,
      status: 'failed',
      failureStage: 'parse',
      problem: { reason: 'unreadable', fixTarget: null },
      error: {
        code: 'missing-interchange-trailer',
        message: 'No UNZ',
        position: null,
        details: null,
      },
      messageIndex: 1,
    })

    const response = await loaded(document.id)

    expect(response.statusCode, response.body).toBe(200)
    expect(interchangeSchema.parse(response.json())).toMatchObject({
      sender: { identification: null, name: 'Moselgut AG' },
      receiver: { identification: null, name: 'Nordwind Foods' },
      runs: [{ id: run.id, messageReference: null }],
    })
  })

  it('answers 404 for a Run without an Interchange, an unknown id and another Workspace', async () => {
    const partner = await addTradingPartner(workspace, 'Harzgold KG', '4012345000078')

    const unsent = await partner.addRun({
      flowId: partner.invoic.id,
      status: 'processing',
      receivedAt: hoursAgo(1),
    })

    const other = await seedInvoiceWorkspace(api.connection.db, 'Harzfood')
    const outsider = await addTradingPartner(other, 'Harzgold KG', '4012345000078')
    const foreign = await outsider.sendInvoice({ controlReference: 7, handedOverAt: hoursAgo(1) })

    for (const id of [
      unsent.id,
      unsent.documentId!,
      foreign.id,
      crypto.randomUUID(),
      'not-an-id',
    ]) {
      expect((await loaded(id)).statusCode).toBe(404)
    }
  })
})
