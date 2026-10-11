import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openMessageTypes,
  type OrderLifecycle,
  orderLifecyclesEndpoint,
  type OrderLifecycleQuery,
  toSearchParams,
} from '@edi-bridge/contracts'

import { orderLifecycleHandler, orderLifecycleReferences } from './order-lifecycle'

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

function search(query: Partial<OrderLifecycleQuery>) {
  return fetch(`${apiUrl}${orderLifecyclesEndpoint.path}?${toSearchParams(query)}`)
}

async function lifecyclesOf(businessReference: string) {
  const response = await search({ businessReference })

  return orderLifecyclesEndpoint.response.parse(await response.json())
}

const stepsOf = ({ messages }: OrderLifecycle) =>
  messages.map(({ messageType, run, interchange }) => [
    messageType,
    run.status,
    interchange?.acknowledgement ?? null,
  ])

describe('GET /order-lifecycles', () => {
  it('shows ORDERS, DESADV and INVOIC of a full Order Lifecycle in order', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    const [lifecycle, ...others] = await lifecyclesOf(orderLifecycleReferences.full)

    expect(others).toEqual([])
    expect(lifecycle).toMatchObject({
      businessReference: orderLifecycleReferences.full,
      tradingPartner: { name: 'Hansemarkt GmbH' },
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

    const response = await search({ businessReference: orderLifecycleReferences.serverError })

    expect(response.status).toBe(500)
  })

  it('rejects a search without a Business Reference', async () => {
    server.use(orderLifecycleHandler(apiUrl))

    expect((await search({})).status).toBe(400)
  })

  it('answers every search with a server error in the error state', async () => {
    server.use(orderLifecycleHandler(apiUrl, 'error'))

    expect((await search({ businessReference: orderLifecycleReferences.full })).status).toBe(500)
  })
})
