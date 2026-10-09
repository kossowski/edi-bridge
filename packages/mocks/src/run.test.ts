import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type RunListQuery,
  runListSchema,
  runsEndpoint,
  toSearchParams,
} from '@edi-bridge/contracts'

import { createRun, runsHandler, seedRuns } from './run'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listRuns(query: Partial<RunListQuery> = {}) {
  const response = await fetch(`${apiUrl}${runsEndpoint.path}?${toSearchParams(query)}`)

  return {
    status: response.status,
    body: response.ok ? runListSchema.parse(await response.json()) : undefined,
  }
}

describe('GET /runs', () => {
  it('serves the newest Runs first, one page at a time, with the total count', async () => {
    const runs = [
      createRun({
        id: '00000000-0000-4000-8000-000000000001',
        receivedAt: '2026-10-01T08:00:00.000Z',
      }),
      createRun({
        id: '00000000-0000-4000-8000-000000000002',
        receivedAt: '2026-10-03T08:00:00.000Z',
      }),
      createRun({
        id: '00000000-0000-4000-8000-000000000003',
        receivedAt: '2026-10-02T08:00:00.000Z',
      }),
    ]

    server.use(runsHandler(apiUrl, runs))

    const { body } = await listRuns({ page: 1, pageSize: 2 })

    expect(body?.total).toBe(3)
    expect(body?.runs.map((run) => run.id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ])
  })

  it('filters by several statuses at once', async () => {
    server.use(
      runsHandler(apiUrl, [
        createRun({
          id: '00000000-0000-4000-8000-000000000001',
          status: 'delivered',
          failureStage: null,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000002',
          status: 'duplicate',
          failureStage: null,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000003',
          status: 'failed',
          failureStage: 'parse',
        }),
      ]),
    )

    const { body } = await listRuns({ status: ['duplicate', 'failed'] })

    expect(body?.runs.map((run) => run.id).sort()).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ])
  })

  it('filters by Failure Stage and leaves out Runs that did not fail', async () => {
    server.use(
      runsHandler(apiUrl, [
        createRun({
          id: '00000000-0000-4000-8000-000000000001',
          status: 'delivered',
          failureStage: null,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000002',
          status: 'failed',
          failureStage: 'mapping',
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000003',
          status: 'failed',
          failureStage: 'delivery',
        }),
      ]),
    )

    const { body } = await listRuns({ failureStage: ['mapping'] })

    expect(body?.runs.map((run) => run.id)).toEqual(['00000000-0000-4000-8000-000000000002'])
  })

  it('filters by Trading Partner, Message Type and Flow together', async () => {
    const hansemarkt = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }
    const rheinkauf = { id: '10000000-0000-4000-8000-000000000003', name: 'Rheinkauf eG' }

    const ordersFlow = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Hansemarkt ORDERS inbound',
    }

    const otherFlow = { id: '20000000-0000-4000-8000-000000000099', name: 'Hansemarkt ORDERS test' }
    server.use(
      runsHandler(apiUrl, [
        createRun({
          id: '00000000-0000-4000-8000-000000000001',
          tradingPartner: hansemarkt,
          messageType: 'ORDERS',
          flow: ordersFlow,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000002',
          tradingPartner: rheinkauf,
          messageType: 'ORDERS',
          flow: ordersFlow,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000003',
          tradingPartner: hansemarkt,
          messageType: 'INVOIC',
          flow: ordersFlow,
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000004',
          tradingPartner: hansemarkt,
          messageType: 'ORDERS',
          flow: otherFlow,
        }),
      ]),
    )

    const { body } = await listRuns({
      tradingPartnerId: [hansemarkt.id],
      messageType: ['ORDERS'],
      flowId: [ordersFlow.id],
    })

    expect(body?.runs.map((run) => run.id)).toEqual(['00000000-0000-4000-8000-000000000001'])
  })

  it('filters by a time range that includes both of its ends', async () => {
    server.use(
      runsHandler(apiUrl, [
        createRun({
          id: '00000000-0000-4000-8000-000000000001',
          receivedAt: '2026-10-01T23:59:59.999Z',
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000002',
          receivedAt: '2026-10-02T00:00:00.000Z',
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000003',
          receivedAt: '2026-10-02T23:59:59.999Z',
        }),
        createRun({
          id: '00000000-0000-4000-8000-000000000004',
          receivedAt: '2026-10-03T00:00:00.000Z',
        }),
      ]),
    )

    const { body } = await listRuns({
      receivedFrom: '2026-10-02T00:00:00Z',
      receivedTo: '2026-10-02T23:59:59.999Z',
    })

    expect(body?.runs.map((run) => run.id)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ])
  })

  it.each([
    [true, ['00000000-0000-4000-8000-000000000001']],
    [false, ['00000000-0000-4000-8000-000000000002']],
  ])('filters by Manual Submission = %s', async (manualSubmission, expected) => {
    server.use(
      runsHandler(apiUrl, [
        createRun({ id: '00000000-0000-4000-8000-000000000001', manualSubmission: true }),
        createRun({ id: '00000000-0000-4000-8000-000000000002', manualSubmission: false }),
      ]),
    )

    const { body } = await listRuns({ manualSubmission })

    expect(body?.runs.map((run) => run.id)).toEqual(expected)
  })

  it('rejects a query with an unknown status', async () => {
    server.use(runsHandler(apiUrl, []))

    const response = await fetch(`${apiUrl}${runsEndpoint.path}?status=lost`)

    expect(response.status).toBe(400)
  })

  it('rejects APERAK, which is outside the MVP Message Types', async () => {
    server.use(runsHandler(apiUrl, []))

    const response = await fetch(`${apiUrl}${runsEndpoint.path}?messageType=APERAK`)

    expect(response.status).toBe(400)
  })

  it('never seeds an outbound Run that failed at parsing', async () => {
    server.use(runsHandler(apiUrl))

    const outboundFailures = await listRuns({
      status: ['failed'],
      messageType: ['DESADV', 'INVOIC'],
    })

    const outboundParseFailures = await listRuns({
      failureStage: ['parse'],
      messageType: ['DESADV', 'INVOIC'],
    })

    expect(outboundFailures.body?.total).toBeGreaterThan(0)
    expect(outboundParseFailures.body?.total).toBe(0)
  })

  it('never seeds a CONTRL that failed at mapping, because no Mapping Version can fix an unmatched control reference', async () => {
    server.use(runsHandler(apiUrl))

    const contrlFailures = await listRuns({ status: ['failed'], messageType: ['CONTRL'] })

    const contrlMappingFailures = await listRuns({
      failureStage: ['mapping'],
      messageType: ['CONTRL'],
    })

    expect(contrlFailures.body?.total).toBeGreaterThan(0)
    expect(contrlMappingFailures.body?.total).toBe(0)
  })

  it('serves more than 10,000 seeded Runs by default', async () => {
    server.use(runsHandler(apiUrl))

    const { body } = await listRuns({ page: 3, pageSize: 100 })

    expect(body?.total).toBeGreaterThan(10_000)
    expect(body?.runs).toHaveLength(100)
  })
})

describe('seedRuns', () => {
  const runsOf = (tradingPartnerId: string) =>
    seedRuns().filter(({ tradingPartner }) => tradingPartner.id === tradingPartnerId)

  it('gives a Trading Partner in Test Mode only a handful of test Runs', () => {
    const inTestMode = seedTradingPartners.filter(
      ({ testMode, onboarding }) => testMode && onboarding.testInterchangeSentAt !== null,
    )

    expect(inTestMode.length).toBeGreaterThan(0)

    for (const { id } of inTestMode) {
      expect(runsOf(id).length).toBeGreaterThan(0)
      expect(runsOf(id).length).toBeLessThanOrEqual(20)
    }
  })

  it('has no CONTRL Run from a Trading Partner whose CONTRL is not received yet', () => {
    const awaitingContrl = seedTradingPartners.filter(
      ({ onboarding }) => onboarding.contrlReceivedAt === null,
    )

    expect(awaitingContrl.length).toBeGreaterThan(0)

    for (const { id } of awaitingContrl) {
      expect(runsOf(id).filter(({ messageType }) => messageType === 'CONTRL')).toEqual([])
    }
  })
})
