import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  orderLifecycleEndpoint,
  orderLifecycleListSchema,
  orderLifecycleSchema,
  orderLifecyclesEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { acknowledgements, documents, flows, runs, tradingPartners } from '@edi-bridge/db'
import { type InvoiceWorkspace, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { addMember, type Client, one, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

const hour = 60 * 60 * 1000

const now = Date.now()

const hoursAgo = (hours: number) => new Date(now - hours * hour)

const failure = {
  status: 'failed' as const,
  error: {
    code: 'processingDefect',
    message: 'The processing failed',
    position: null,
    details: null,
  },
  problem: { reason: 'defect' as const, fixTarget: null },
}

type MessageType = 'ORDERS' | 'DESADV' | 'INVOIC' | 'CONTRL'

// The ids the assertions name, set while seeding.
const seeded = {
  hanseOrders: '',
  hanseOrdersDocument: '',
  hanseDesadv: '',
  duplicateOrders: '',
  failedDesadv: '',
  reprocessedDesadv: '',
  waitingOrders: '',
  expiredOrders: '',
  notSentOrders: '',
  notSentOrdersDocument: '',
  alpenfrischId: '',
}

const waitingSince = hoursAgo(29)

async function seedLifecycles(target: InvoiceWorkspace, db = api.connection.db) {
  const document = (interchangeControlReference: string | null = null) =>
    one(
      db
        .insert(documents)
        .values({
          workspaceId: target.id,
          channelId: target.inboundChannelId,
          fileName: 'message.edi',
          content: 'UNA',
          interchangeSender: interchangeControlReference && '4071615111110',
          interchangeControlReference,
        })
        .returning(),
    )

  const flowOf = (messageType: MessageType, tradingPartnerId = target.tradingPartnerId) =>
    one(
      db
        .insert(flows)
        .values({
          workspaceId: target.id,
          tradingPartnerId,
          messageType,
          name: `${messageType} flow`,
          inboundChannelId: target.inboundChannelId,
          destinationChannelId: target.outboundChannelId,
          mappingVersionId: target.mappingVersionId,
        })
        .returning(),
    )

  const alpenfrisch = await one(
    db
      .insert(tradingPartners)
      .values({
        workspaceId: target.id,
        name: 'Alpenfrisch Märkte AG',
        gln: '4012345000009',
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 48,
      })
      .returning(),
  )

  const orders = await flowOf('ORDERS')
  const desadv = await flowOf('DESADV')
  const alpenfrischOrders = await flowOf('ORDERS', alpenfrisch.id)

  const run = async (values: Partial<typeof runs.$inferInsert> & { flowId: string }) => {
    const flow = [orders, desadv, alpenfrischOrders].find(({ id }) => id === values.flowId)

    return one(
      db
        .insert(runs)
        .values({
          workspaceId: target.id,
          documentId: (await document()).id,
          tradingPartnerId: flow?.tradingPartnerId ?? target.tradingPartnerId,
          manualSubmission: false,
          status: 'delivered',
          ...values,
        })
        .returning(),
    )
  }

  const ordersDocument = await document('ORD1')

  const hanseOrders = await run({
    flowId: orders.id,
    documentId: ordersDocument.id,
    businessReference: '4711',
    receivedAt: hoursAgo(100),
  })

  const hanseDesadv = await run({
    flowId: desadv.id,
    businessReference: '4711',
    receivedAt: hoursAgo(90),
    handedOverAt: hoursAgo(90),
    controlReference: 7,
    acknowledgementState: 'accepted',
  })

  // Handed over before Acknowledgements were tracked, so it has no Acknowledgement.
  await run({
    flowId: target.flowId,
    businessReference: '4711',
    receivedAt: hoursAgo(80),
    handedOverAt: hoursAgo(80),
    controlReference: 8,
    acknowledgementState: null,
  })

  // A Duplicate is never mapped, so it has no Business Reference of its own.
  const duplicateOrders = await run({
    flowId: orders.id,
    status: 'duplicate',
    duplicateOfRunId: hanseOrders.id,
    receivedAt: hoursAgo(70),
  })

  // Retention deleted the Document of this Run.
  const expiredOrders = await run({
    flowId: alpenfrischOrders.id,
    documentId: null,
    documentDeletedAt: hoursAgo(1),
    businessReference: '4711',
    receivedAt: hoursAgo(110),
  })

  await run({ flowId: alpenfrischOrders.id, businessReference: '4711', receivedAt: hoursAgo(60) })

  const failedDesadv = await run({
    flowId: desadv.id,
    ...failure,
    failureStage: 'mapping',
    businessReference: '4712',
    receivedAt: hoursAgo(50),
  })

  const reprocessedDesadv = await run({
    flowId: desadv.id,
    businessReference: '4712',
    replacesRunId: failedDesadv.id,
    receivedAt: hoursAgo(40),
    handedOverAt: hoursAgo(40),
    controlReference: 9,
    acknowledgementState: 'rejected',
  })

  const waitingOrders = await run({
    flowId: orders.id,
    ...failure,
    failureStage: 'parse',
    businessReference: '4713',
    receivedAt: hoursAgo(30),
    waitingForTradingPartnerSince: waitingSince,
  })

  const notSentDocument = await document('ORD2')

  await db.insert(acknowledgements).values({
    workspaceId: target.id,
    documentId: notSentDocument.id,
    tradingPartnerId: target.tradingPartnerId,
    notSentReason: 'noOutboundChannel',
  })

  const notSentOrders = await run({
    flowId: orders.id,
    documentId: notSentDocument.id,
    businessReference: '4714',
    receivedAt: hoursAgo(20),
  })

  // A Message outside the Order Lifecycle keeps out of it.
  await run({
    flowId: (await flowOf('CONTRL')).id,
    businessReference: '4711',
    receivedAt: hoursAgo(5),
  })

  return {
    hanseOrders: hanseOrders.id,
    hanseOrdersDocument: ordersDocument.id,
    hanseDesadv: hanseDesadv.id,
    duplicateOrders: duplicateOrders.id,
    failedDesadv: failedDesadv.id,
    reprocessedDesadv: reprocessedDesadv.id,
    waitingOrders: waitingOrders.id,
    expiredOrders: expiredOrders.id,
    notSentOrders: notSentOrders.id,
    notSentOrdersDocument: notSentDocument.id,
    alpenfrischId: alpenfrisch.id,
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

  Object.assign(seeded, await seedLifecycles(workspace))

  // Another Workspace with the same Business References.
  await seedLifecycles(await seedInvoiceWorkspace(api.connection.db, 'Sudhafen Logistik'))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listed = async (query = '', as = admin) => {
  const response = await as.inject({
    method: orderLifecyclesEndpoint.method,
    url: `${orderLifecyclesEndpoint.path}?${query}`,
  })

  expect(response.statusCode, response.body).toBe(200)

  return orderLifecycleListSchema.parse(response.json())
}

const lifecycleKeys = (list: Awaited<ReturnType<typeof listed>>) =>
  list.orderLifecycles.map(
    ({ businessReference, tradingPartner }) => `${businessReference} ${tradingPartner.name}`,
  )

const allStatuses = {
  'on-track': 1,
  'needs-attention': 2,
  'waiting-for-trading-partner': 1,
  done: 1,
}

describe('GET /order-lifecycles', () => {
  it('lists the Order Lifecycles of the Workspace by newest activity with their status', async () => {
    const list = await listed()

    expect(lifecycleKeys(list)).toEqual([
      '4714 Hanse Retail',
      '4713 Hanse Retail',
      '4712 Hanse Retail',
      '4711 Alpenfrisch Märkte AG',
      '4711 Hanse Retail',
    ])
    expect(list).toMatchObject({ statusCounts: allStatuses, total: 5, page: 1, pageSize: 50 })
    expect(list.orderLifecycles.map(({ status }) => status)).toEqual([
      'needs-attention',
      'waiting-for-trading-partner',
      'needs-attention',
      'on-track',
      'done',
    ])
    // Its INVOIC was handed over before Acknowledgements were tracked and counts as accepted.
    expect(list.orderLifecycles[4]).toEqual({
      businessReference: '4711',
      tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
      status: 'done',
      startedAt: hoursAgo(100).toISOString(),
      lastActivityAt: hoursAgo(70).toISOString(),
      steps: [
        { messageType: 'ORDERS', state: 'done' },
        { messageType: 'DESADV', state: 'done' },
        { messageType: 'INVOIC', state: 'done' },
      ],
    })
  })

  it('filters by overall status and keeps the counts of every status', async () => {
    const list = await listed('status=done&status=on-track')

    expect(lifecycleKeys(list)).toEqual(['4711 Alpenfrisch Märkte AG', '4711 Hanse Retail'])
    expect(list).toMatchObject({ statusCounts: allStatuses, total: 2 })
  })

  it('lists an Order Lifecycle whose CONTRL to a received Interchange was not sent as needing attention', async () => {
    const list = await listed('status=needs-attention')

    expect(lifecycleKeys(list)).toEqual(['4714 Hanse Retail', '4712 Hanse Retail'])
    expect(list).toMatchObject({ statusCounts: allStatuses, total: 2 })
    expect(list.orderLifecycles[0]).toMatchObject({
      status: 'needs-attention',
      steps: [
        { messageType: 'ORDERS', state: 'needs-attention' },
        { messageType: 'DESADV', state: 'open' },
        { messageType: 'INVOIC', state: 'open' },
      ],
    })
  })

  it.each([
    [
      'an order number',
      '471',
      [
        '4714 Hanse Retail',
        '4713 Hanse Retail',
        '4712 Hanse Retail',
        '4711 Alpenfrisch Märkte AG',
        '4711 Hanse Retail',
      ],
    ],
    ['part of a Trading Partner name', 'ALPEN', ['4711 Alpenfrisch Märkte AG']],
  ])('searches by %s and counts the matches', async (_, q, expected) => {
    const list = await listed(`q=${encodeURIComponent(q)}`)

    expect(lifecycleKeys(list)).toEqual(expected)
    expect(list.total).toBe(expected.length)
  })

  it('counts only the statuses of the matching Order Lifecycles', async () => {
    const list = await listed('q=4712')

    expect(list.statusCounts).toEqual({
      'on-track': 0,
      'needs-attention': 1,
      'waiting-for-trading-partner': 0,
      done: 0,
    })
  })

  it('answers one page of the Order Lifecycles', async () => {
    const list = await listed('page=2&pageSize=3')

    expect(lifecycleKeys(list)).toEqual(['4711 Alpenfrisch Märkte AG', '4711 Hanse Retail'])
    expect(list).toMatchObject({ total: 5, page: 2, pageSize: 3 })
  })

  it('lists nothing of another Workspace', async () => {
    const list = await listed('', api.otherAdmin)

    expect(list).toMatchObject({ orderLifecycles: [], total: 0 })
  })

  it('rejects an unknown status with status 400', async () => {
    const response = await admin.inject({
      method: orderLifecyclesEndpoint.method,
      url: `${orderLifecyclesEndpoint.path}?status=late`,
    })

    expect(response.statusCode).toBe(400)
  })
})

const loaded = async (businessReference: string, as = admin) => {
  const response = await as.inject({
    method: orderLifecycleEndpoint.method,
    url: toPath(orderLifecycleEndpoint.path, { businessReference }),
  })

  expect(response.statusCode, response.body).toBe(200)

  return orderLifecycleSchema.array().parse(response.json())
}

describe('GET /order-lifecycles/:businessReference', () => {
  it('answers one Order Lifecycle per Trading Partner, its Messages oldest first', async () => {
    const lifecycles = await loaded('4711')

    expect(lifecycles.map(({ tradingPartner }) => tradingPartner)).toEqual([
      {
        id: seeded.alpenfrischId,
        name: 'Alpenfrisch Märkte AG',
        acknowledgementTimeLimitHours: 48,
      },
      { id: workspace.tradingPartnerId, name: 'Hanse Retail', acknowledgementTimeLimitHours: 24 },
    ])
    expect(
      lifecycles[1]?.messages.map(({ messageType, run }) => [messageType, run.status]),
    ).toEqual([
      ['ORDERS', 'delivered'],
      ['DESADV', 'delivered'],
      ['INVOIC', 'delivered'],
      ['ORDERS', 'duplicate'],
    ])
  })

  it('shows the Acknowledgement state of a sent Interchange', async () => {
    const [, hanse] = await loaded('4711')

    expect(hanse?.messages[1]).toEqual({
      messageType: 'DESADV',
      direction: 'outbound',
      receivedAt: hoursAgo(90).toISOString(),
      run: {
        id: seeded.hanseDesadv,
        status: 'delivered',
        failureStage: null,
        replacedBy: null,
        waitingForTradingPartnerSince: null,
      },
      interchange: {
        id: seeded.hanseDesadv,
        controlReference: '7',
        acknowledgement: 'accepted',
        notSentReason: null,
      },
    })
  })

  it('shows a sent Interchange without an Acknowledgement', async () => {
    const [, hanse] = await loaded('4711')

    expect(hanse?.messages[2]?.interchange).toMatchObject({
      controlReference: '8',
      acknowledgement: null,
    })
  })

  it('shows a received Interchange without a not-sent reason', async () => {
    const [, hanse] = await loaded('4711')

    expect(hanse?.messages[0]).toMatchObject({
      direction: 'inbound',
      run: { id: seeded.hanseOrders },
      interchange: {
        id: seeded.hanseOrdersDocument,
        controlReference: 'ORD1',
        acknowledgement: null,
        notSentReason: null,
      },
    })
  })

  it('shows why the CONTRL to a received Interchange was not sent', async () => {
    const [lifecycle] = await loaded('4714')

    expect(lifecycle?.messages[0]).toMatchObject({
      direction: 'inbound',
      run: { id: seeded.notSentOrders },
      interchange: {
        id: seeded.notSentOrdersDocument,
        controlReference: 'ORD2',
        acknowledgement: null,
        notSentReason: 'noOutboundChannel',
      },
    })
  })

  it('keeps a Run whose Document retention deleted, without its Interchange', async () => {
    const [alpenfrisch] = await loaded('4711')

    expect(alpenfrisch?.messages[0]).toMatchObject({
      run: { id: seeded.expiredOrders, status: 'delivered' },
      interchange: null,
    })
  })

  it('shows a Duplicate under the Business Reference of its original', async () => {
    const [, hanse] = await loaded('4711')

    expect(hanse?.messages[3]?.run).toMatchObject({ id: seeded.duplicateOrders })
  })

  it('links a reprocessed Run to the Run that replaced it', async () => {
    const [lifecycle] = await loaded('4712')

    expect(lifecycle?.messages.map(({ run }) => run)).toEqual([
      {
        id: seeded.failedDesadv,
        status: 'failed',
        failureStage: 'mapping',
        replacedBy: { id: seeded.reprocessedDesadv },
        waitingForTradingPartnerSince: null,
      },
      {
        id: seeded.reprocessedDesadv,
        status: 'delivered',
        failureStage: null,
        replacedBy: null,
        waitingForTradingPartnerSince: null,
      },
    ])
    expect(lifecycle?.messages[0]?.interchange).toBeNull()
    expect(lifecycle?.messages[1]?.interchange?.acknowledgement).toBe('rejected')
  })

  it('answers a partial Order Lifecycle that waits for the Trading Partner', async () => {
    const [lifecycle, ...others] = await loaded('4713')

    expect(others).toEqual([])
    expect(lifecycle?.messages).toEqual([
      {
        messageType: 'ORDERS',
        direction: 'inbound',
        receivedAt: hoursAgo(30).toISOString(),
        run: {
          id: seeded.waitingOrders,
          status: 'failed',
          failureStage: 'parse',
          replacedBy: null,
          waitingForTradingPartnerSince: waitingSince.toISOString(),
        },
        interchange: null,
      },
    ])
  })

  it('answers no Order Lifecycle for an unknown Business Reference or another Workspace', async () => {
    expect(await loaded('0000')).toEqual([])
    expect(await loaded('4711', api.otherAdmin)).toEqual([])
  })

  it('rejects a Business Reference longer than 35 characters with status 400', async () => {
    const response = await admin.inject({
      method: orderLifecycleEndpoint.method,
      url: toPath(orderLifecycleEndpoint.path, { businessReference: '9'.repeat(36) }),
    })

    expect(response.statusCode).toBe(400)
  })
})
