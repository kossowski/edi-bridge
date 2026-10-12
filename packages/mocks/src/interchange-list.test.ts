import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  interchangeEndpoint,
  type InterchangeListQuery,
  interchangesEndpoint,
  type RunSummary,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'

import { interchangesHandler } from './interchange-list'
import { createRun, createRuns, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

// A busy CI runner takes seconds to build the 12,000 seeded Runs. Built once here, they stay out
// of the time limit of the first test that reads them.
beforeAll(() => {
  seedRuns()
})

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listInterchanges(query: Partial<InterchangeListQuery> = {}) {
  const response = await fetch(`${apiUrl}${interchangesEndpoint.path}?${toSearchParams(query)}`)

  return {
    status: response.status,
    body: response.ok ? interchangesEndpoint.response.parse(await response.json()) : undefined,
  }
}

const hansemarkt = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }

const ordersFlow = { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' }

function inboundOrders(
  id: string,
  receivedAt: string,
  overrides: Partial<Pick<RunSummary, 'businessReference' | 'tradingPartner'>> = {},
) {
  return createRun({
    id,
    tradingPartner: hansemarkt,
    messageType: 'ORDERS',
    flow: ordersFlow,
    receivedAt,
    status: 'delivered',
    failureStage: null,
    ...overrides,
  })
}

describe('GET /interchanges', () => {
  it('lists each Interchange newest first with the Runs it produced, as its detail shows them', async () => {
    const seeded = createRuns({ count: 300 })
    const runs = createRunStore(seeded, seedReprocessed(seeded))
    server.use(interchangesHandler(apiUrl, runs), ...runDetailHandlers(apiUrl, { runs }))
    const { body } = await listInterchanges({ pageSize: 100 })
    const interchanges = body!.interchanges

    expect(body?.total).toBeGreaterThan(100)
    expect(interchanges.map(({ preparedAt }) => preparedAt)).toEqual(
      interchanges.map(({ preparedAt }) => preparedAt).toSorted((a, b) => b.localeCompare(a)),
    )

    for (const listed of interchanges.slice(0, 40)) {
      const response = await fetch(
        `${apiUrl}${toPath(interchangeEndpoint.path, { id: listed.id })}`,
      )

      const detail = interchangeEndpoint.response.parse(await response.json())

      expect(listed).toMatchObject({
        controlReference: detail.controlReference,
        direction: detail.direction,
      })
      expect(listed.runs.map(({ id }) => id)).toEqual(detail.runs.map(({ id }) => id))
      const at = listed.preparedAt

      expect(detail.raw).toContain(
        `+${at.slice(2, 4)}${at.slice(5, 7)}${at.slice(8, 10)}:${at.slice(11, 13)}${at.slice(14, 16)}+`,
      )

      for (const run of listed.runs) {
        expect(run.interchange).toEqual({
          id: listed.id,
          controlReference: listed.controlReference,
        })
        expect(run.tradingPartner).toEqual(listed.tradingPartner)
      }
    }
  })

  it('bundles inbound Runs received together into one Interchange and leaves out Runs without one', async () => {
    const first = inboundOrders('00000000-0000-4000-8000-000000000001', '2026-10-01T08:00:00.000Z')
    const second = inboundOrders('00000000-0000-4000-8000-000000000002', '2026-10-01T08:00:00.000Z')

    const unmapped = createRun({
      id: '00000000-0000-4000-8000-000000000003',
      messageType: 'INVOIC',
      status: 'failed',
      failureStage: 'mapping',
    })

    server.use(interchangesHandler(apiUrl, [first, second, unmapped]))
    const { body } = await listInterchanges()

    expect(body?.total).toBe(1)
    expect(body?.interchanges[0]).toMatchObject({
      direction: 'inbound',
      tradingPartner: hansemarkt,
      preparedAt: '2026-10-01T08:00:00.000Z',
    })
    expect(body?.interchanges[0]?.runs.map(({ id }) => id)).toEqual([first.id, second.id])
  })

  it('searches the control reference, the Trading Partner and the Business Reference, ignoring case', async () => {
    const order = inboundOrders(
      '00000000-0000-4000-8000-000000000001',
      '2026-10-01T08:00:00.000Z',
      {
        businessReference: 'PO-4711',
      },
    )

    const other = inboundOrders(
      '00000000-0000-4000-8000-000000000002',
      '2026-10-02T08:00:00.000Z',
      {
        tradingPartner: { id: '10000000-0000-4000-8000-000000000002', name: 'Kaufhof Nord' },
      },
    )

    const runs = createRunStore([order, other])
    server.use(interchangesHandler(apiUrl, runs))

    const idsFor = async (q: string) =>
      (await listInterchanges({ q })).body?.interchanges.map(({ runs }) => runs[0]!.id)

    expect(await idsFor('po-47')).toEqual([order.id])
    expect(await idsFor('KAUFHOF')).toEqual([other.id])
    expect(await idsFor(runs.get(other.id)!.interchange!.controlReference)).toEqual([other.id])
    expect(await idsFor('  ')).toEqual([other.id, order.id])
  })

  it('filters by Trading Partner and Message Type', async () => {
    server.use(interchangesHandler(apiUrl))
    const tradingPartnerId = seedRuns()[0]!.tradingPartner.id

    const { body } = await listInterchanges({
      tradingPartnerId: [tradingPartnerId],
      messageType: ['INVOIC'],
    })

    expect(body?.total).toBeGreaterThan(0)

    for (const { tradingPartner, runs } of body!.interchanges) {
      expect(tradingPartner.id).toBe(tradingPartnerId)
      expect(runs.every(({ messageType }) => messageType === 'INVOIC')).toBe(true)
    }
  })

  it('serves the seeded volume one page at a time', async () => {
    server.use(interchangesHandler(apiUrl))
    const { body } = await listInterchanges({ page: 2, pageSize: 100 })

    expect(body?.total).toBeGreaterThan(5_000)
    expect(body?.page).toBe(2)
    expect(body?.interchanges).toHaveLength(100)
  })

  it('rejects an unknown Message Type', async () => {
    server.use(interchangesHandler(apiUrl))
    const response = await fetch(`${apiUrl}${interchangesEndpoint.path}?messageType=APERAK`)

    expect(response.status).toBe(400)
  })
})
