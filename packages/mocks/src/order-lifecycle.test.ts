import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openMessageTypes,
  type OrderLifecycle,
  orderLifecycleEndpoint,
  type OrderLifecycleListQuery,
  orderLifecycleStatuses,
  orderLifecycleStatusOf,
  orderLifecyclesEndpoint,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'

import {
  orderLifecycleHandler,
  orderLifecycleListHandler,
  orderLifecycleReferences,
  seedOrderLifecycles,
} from './order-lifecycle'
import { createRuns } from './run'
import { createRunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const now = new Date('2026-10-10T12:20:00.000Z')

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

afterAll(() => server.close())

function search(businessReference: string) {
  return fetch(`${apiUrl}${toPath(orderLifecycleEndpoint.path, { businessReference })}`)
}

async function lifecyclesOf(businessReference: string) {
  const response = await search(businessReference)

  return orderLifecycleEndpoint.response.parse(await response.json())
}

async function list(query: Partial<OrderLifecycleListQuery> = {}) {
  const response = await fetch(`${apiUrl}${orderLifecyclesEndpoint.path}?${toSearchParams(query)}`)

  return {
    status: response.status,
    body: response.ok ? orderLifecyclesEndpoint.response.parse(await response.json()) : undefined,
  }
}

const stepsOf = ({ messages }: OrderLifecycle) =>
  messages.map(({ messageType, run, interchange }) => [
    messageType,
    run.status,
    interchange?.acknowledgement ?? null,
  ])

describe('GET /order-lifecycles/:businessReference', () => {
  it('shows ORDERS, DESADV and INVOIC of a full Order Lifecycle in order', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle, ...others] = await lifecyclesOf(orderLifecycleReferences.full)

    expect(others).toEqual([])
    expect(lifecycle).toMatchObject({
      businessReference: orderLifecycleReferences.full,
      tradingPartner: { name: 'Hansemarkt GmbH', acknowledgementTimeLimitHours: 24 },
    })
    expect(stepsOf(lifecycle!)).toEqual([
      ['ORDERS', 'delivered', null],
      ['DESADV', 'delivered', 'accepted'],
      ['INVOIC', 'delivered', 'accepted'],
    ])
  })

  it('leaves INVOIC open while the DESADV of a partial lifecycle awaits its Acknowledgement', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.partial)

    expect(stepsOf(lifecycle!)).toEqual([
      ['ORDERS', 'delivered', null],
      ['DESADV', 'delivered', 'pending'],
    ])
    expect(openMessageTypes(lifecycle!.messages)).toEqual(['INVOIC'])
  })

  it('says why the CONTRL to the ORDERS of a partial lifecycle was not sent', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.partial)

    expect(
      lifecycle!.messages.map(({ messageType, interchange }) => [
        messageType,
        interchange?.notSentReason,
      ]),
    ).toEqual([
      ['ORDERS', 'noOutboundChannel'],
      ['DESADV', null],
    ])
  })

  it('has no not-sent reason where the CONTRL was sent', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.full)

    expect(lifecycle!.messages.map(({ interchange }) => interchange?.notSentReason)).toEqual([
      null,
      null,
      null,
    ])
  })

  it('shows one Order Lifecycle per Trading Partner that uses the same order number', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const lifecycles = await lifecyclesOf(orderLifecycleReferences.multiPartner)

    expect(lifecycles.map(({ tradingPartner }) => tradingPartner.name)).toEqual([
      'Alpenfrisch Märkte AG',
      'Hansemarkt GmbH',
    ])
    expect(stepsOf(lifecycles[0]!)).toEqual([
      ['ORDERS', 'delivered', null],
      ['DESADV', 'delivered', 'overdue'],
    ])
  })

  it('shows failed Runs, the Run that reprocessed one and a rejected Acknowledgement', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.failures)
    const { messages } = lifecycle!

    expect(
      messages.map(({ messageType, run }) => [messageType, run.status, run.failureStage]),
    ).toEqual([
      ['ORDERS', 'delivered', null],
      ['DESADV', 'failed', 'mapping'],
      ['DESADV', 'delivered', null],
      ['INVOIC', 'failed', 'delivery'],
    ])
    expect(messages[1]!.run.replacedBy).toEqual({ id: messages[2]!.run.id })
    expect(messages[1]!.interchange).toBeNull()
    expect(messages[2]!.interchange?.acknowledgement).toBe('rejected')
    expect(messages[3]!.interchange).toMatchObject({ acknowledgement: null })
  })

  it('serves a large-volume lifecycle with many DESADVs, INVOICs and Reprocessed Runs', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.largeVolume)
    const { messages } = lifecycle!

    const count = (predicate: (message: (typeof messages)[number]) => boolean) =>
      messages.filter(predicate).length

    expect(count(({ messageType }) => messageType === 'ORDERS')).toBe(1)
    expect(count(({ messageType }) => messageType === 'DESADV')).toBe(34)
    expect(count(({ messageType }) => messageType === 'INVOIC')).toBe(30)
    expect(count(({ run }) => run.replacedBy !== null)).toBe(4)
    expect(
      new Set(messages.map(({ interchange }) => interchange?.acknowledgement ?? null)),
    ).toEqual(new Set([null, 'pending', 'accepted', 'rejected', 'overdue']))
  })

  it('finds no Order Lifecycle for an unknown Business Reference', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    expect(await lifecyclesOf(orderLifecycleReferences.noMatch)).toEqual([])
  })

  it('matches the Business Reference exactly', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    expect(await lifecyclesOf('471')).toEqual([])
  })

  it('answers with a server error for the error Business Reference', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const response = await search(orderLifecycleReferences.serverError)

    expect(response.status).toBe(500)
  })

  it('rejects a blank Business Reference', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    expect((await search(' ')).status).toBe(400)
  })

  it('shows a failed Run that waits for the partner since it was marked', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.waitingForTradingPartner)

    const { run } = lifecycle!.messages[0]!

    expect(run).toMatchObject({ status: 'failed', failureStage: 'parse' })
    expect(run.waitingForTradingPartnerSince).not.toBeNull()
    expect(orderLifecycleStatusOf(lifecycle!.messages)).toBe('waiting-for-trading-partner')
  })

  it('shows a Run as waiting for the partner once it is marked elsewhere', async () => {
    const { orderLifecycles } = seedOrderLifecycles(now)

    const failed = orderLifecycles
      .find(({ businessReference }) => businessReference === orderLifecycleReferences.failures)!
      .messages.find(({ run }) => run.status === 'failed' && run.replacedBy === null)!

    const waitingForTradingPartnerSince = new Map([[failed.run.id, now.toISOString()]])

    server.use(orderLifecycleHandler(apiUrl, orderLifecycles, { waitingForTradingPartnerSince }))

    const [lifecycle] = await lifecyclesOf(orderLifecycleReferences.failures)

    expect(lifecycle!.messages.find(({ run }) => run.id === failed.run.id)!.run).toMatchObject({
      waitingForTradingPartnerSince: now.toISOString(),
    })
  })

  it('answers every search with a server error in the error state', async () => {
    server.use(orderLifecycleHandler(apiUrl, 'error'))

    expect((await search(orderLifecycleReferences.full)).status).toBe(500)
  })
})

describe('GET /order-lifecycles', () => {
  it('lists one summary per order number and Trading Partner, most recent activity first', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const { body } = await list()
    const orders = body!.orderLifecycles

    expect(
      orders.map(({ businessReference, tradingPartner }) => [
        businessReference,
        tradingPartner.name,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [orderLifecycleReferences.multiPartner, 'Hansemarkt GmbH'],
        [orderLifecycleReferences.multiPartner, 'Alpenfrisch Märkte AG'],
      ]),
    )
    expect(body!.total).toBe(orders.length)

    const lastActivity = orders.map(({ lastActivityAt }) => Date.parse(lastActivityAt))

    expect(lastActivity).toEqual(lastActivity.toSorted((a, b) => b - a))
  })

  it('summarises each order with its overall status and the state of its three steps', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const { body } = await list({ q: orderLifecycleReferences.partial })

    expect(body!.orderLifecycles).toEqual([
      expect.objectContaining({
        businessReference: orderLifecycleReferences.partial,
        status: 'waiting-for-trading-partner',
        steps: [
          { messageType: 'ORDERS', state: 'done' },
          { messageType: 'DESADV', state: 'waiting-for-trading-partner' },
          { messageType: 'INVOIC', state: 'open' },
        ],
      }),
    ])
    expect(body!.orderLifecycles[0]!.tradingPartner.name).toBe('Rheinkauf eG')
  })

  it('covers every overall status in the seed, with an overdue receipt confirmation', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const { body } = await list()

    expect(new Set(body!.orderLifecycles.map(({ status }) => status))).toEqual(
      new Set(orderLifecycleStatuses),
    )
    expect(
      body!.orderLifecycles.find(
        ({ businessReference, tradingPartner }) =>
          businessReference === orderLifecycleReferences.multiPartner &&
          tradingPartner.name === 'Alpenfrisch Märkte AG',
      ),
    ).toMatchObject({ status: 'needs-attention' })
  })

  it('searches the order number and the partner name regardless of case', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const byPartner = (await list({ q: 'alpenFRISCH' })).body!.orderLifecycles
    const byNumber = (await list({ q: '471' })).body!.orderLifecycles

    expect(byPartner.map(({ businessReference }) => businessReference)).toEqual([
      orderLifecycleReferences.multiPartner,
    ])
    expect(byNumber.length).toBeGreaterThan(1)
    expect(byNumber.every(({ businessReference }) => businessReference.includes('471'))).toBe(true)
  })

  it('filters by status and counts every status of the search for the filter chips', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const all = (await list({ q: '471' })).body!
    const { body } = await list({ q: '471', status: ['needs-attention', 'done'] })

    expect(body!.orderLifecycles.length).toBeGreaterThan(0)
    expect(
      body!.orderLifecycles.every(({ status }) => ['needs-attention', 'done'].includes(status)),
    ).toBe(true)
    expect(body!.statusCounts).toEqual(all.statusCounts)
    expect(body!.total).toBe(body!.statusCounts['needs-attention'] + body!.statusCounts.done)
    expect(Object.values(all.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(all.total)
  })

  it('pages the orders', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const first = (await list({ pageSize: 2 })).body!
    const second = (await list({ pageSize: 2, page: 2 })).body!

    expect(first.orderLifecycles).toHaveLength(2)
    expect(second.orderLifecycles[0]).not.toEqual(first.orderLifecycles[0])
    expect(second.total).toBe(first.total)
  })

  it('finds no order for a search that matches nothing', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const { body } = await list({ q: 'nothing like this' })

    expect(body).toMatchObject({
      orderLifecycles: [],
      total: 0,
      statusCounts: {
        'on-track': 0,
        'needs-attention': 0,
        'waiting-for-trading-partner': 0,
        done: 0,
      },
    })
  })

  it('rejects an unknown status', async () => {
    server.use(orderLifecycleListHandler(apiUrl))

    const response = await fetch(`${apiUrl}${orderLifecyclesEndpoint.path}?status=late`)

    expect(response.status).toBe(400)
  })

  it('lists no order in the empty state', async () => {
    server.use(orderLifecycleListHandler(apiUrl, 'empty'))

    expect((await list()).body).toMatchObject({ orderLifecycles: [], total: 0 })
  })

  it('answers with a server error in the error state', async () => {
    server.use(orderLifecycleListHandler(apiUrl, 'error'))

    expect((await list()).status).toBe(500)
  })

  it('serves hundreds of orders of every status and partner in the large-volume state', async () => {
    server.use(orderLifecycleListHandler(apiUrl, 'large'))

    const { body } = await list({ pageSize: 100 })

    expect(body!.total).toBeGreaterThanOrEqual(200)
    expect(Object.values(body!.statusCounts).every((count) => count >= 20)).toBe(true)

    const partners = new Set<string>()

    for (let page = 1; page <= Math.ceil(body!.total / 100); page += 1) {
      for (const { tradingPartner } of (await list({ pageSize: 100, page })).body!
        .orderLifecycles) {
        partners.add(tradingPartner.name)
      }
    }

    expect(partners).toEqual(new Set(seedTradingPartners.map(({ name }) => name)))
  })

  it('lists the orders of the Runs next to the curated ones', async () => {
    const { orderLifecycles, runs } = seedOrderLifecycles(now)
    const store = createRunStore([...runs, ...createRuns({ count: 50, now })])

    server.use(orderLifecycleListHandler(apiUrl, orderLifecycles, { runs: store }))

    const { body } = await list({ pageSize: 100 })

    const keys = body!.orderLifecycles.map(
      ({ businessReference, tradingPartner }) => `${businessReference} ${tradingPartner.id}`,
    )

    expect(body!.total).toBeGreaterThan(orderLifecycles.length)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
