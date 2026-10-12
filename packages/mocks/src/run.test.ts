import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type RunListQuery,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'

import { seedFlows, seedMappings } from './flow'
import { createRun, createRuns, runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
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

  it('filters by the Mapping that the Flow of each Run uses', async () => {
    const mappingOf = (flowId: string) => {
      const versionId = seedFlows.find(({ id }) => id === flowId)!.mappingVersionId

      return seedMappings.find(({ versions }) => versions.some(({ id }) => id === versionId))!
    }

    const shared = seedFlows.filter(
      (flow, _, flows) =>
        flows.filter((other) => mappingOf(other.id) === mappingOf(flow.id)).length > 1,
    )

    const [first, second] = shared
    const other = seedFlows.find((flow) => mappingOf(flow.id) !== mappingOf(first!.id))!

    server.use(
      runsHandler(
        apiUrl,
        [first!, second!, other].map((flow, index) =>
          createRun({
            id: `00000000-0000-4000-8000-00000000000${index + 1}`,
            flow: { id: flow.id, name: flow.name },
            messageType: flow.messageType,
          }),
        ),
      ),
    )

    const { body } = await listRuns({ mappingId: [mappingOf(first!.id).mappingId] })

    expect(body?.runs.map((run) => run.id).sort()).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ])
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

  it('searches the Business Reference and the Trading Partner, ignoring case', async () => {
    const order = createRun({
      id: '00000000-0000-4000-8000-000000000001',
      messageType: 'ORDERS',
      businessReference: 'PO-4711',
      tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
    })

    const other = createRun({
      id: '00000000-0000-4000-8000-000000000002',
      messageType: 'ORDERS',
      businessReference: 'PO-5000',
      tradingPartner: { id: '10000000-0000-4000-8000-000000000002', name: 'Kaufhof Nord' },
    })

    server.use(runsHandler(apiUrl, [order, other]))
    const idsFor = async (q: string) => (await listRuns({ q })).body?.runs.map(({ id }) => id)

    expect(await idsFor('po-47')).toEqual([order.id])
    expect(await idsFor('kaufHOF')).toEqual([other.id])
    expect(await idsFor(' ')).toHaveLength(2)
  })

  it('counts the Runs per status with every filter except the status', async () => {
    const hansemarkt = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }
    const kaufhof = { id: '10000000-0000-4000-8000-000000000002', name: 'Kaufhof Nord' }

    server.use(
      runsHandler(apiUrl, [
        createRun({ tradingPartner: hansemarkt, status: 'failed', failureStage: 'parse' }),
        createRun({ tradingPartner: hansemarkt, status: 'failed', failureStage: 'delivery' }),
        createRun({ tradingPartner: hansemarkt, status: 'delivered', failureStage: null }),
        createRun({ tradingPartner: kaufhof, status: 'failed', failureStage: 'parse' }),
      ]),
    )

    const { body } = await listRuns({ status: ['delivered'], tradingPartnerId: [hansemarkt.id] })

    expect(body?.total).toBe(1)
    expect(body?.statusCounts).toEqual({
      received: 0,
      processing: 0,
      delivered: 1,
      failed: 2,
      duplicate: 0,
    })
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

describe('GET /runs with Run detail', () => {
  it('lists each Run with the direction, Business Reference and Interchange that its detail shows', async () => {
    const seeded = createRuns({ count: 400 })
    const runs = createRunStore(seeded, seedReprocessed(seeded))
    server.use(runsHandler(apiUrl, runs), ...runDetailHandlers(apiUrl, { runs }))
    const pages = await Promise.all([1, 2, 3, 4].map((page) => listRuns({ page, pageSize: 100 })))
    const listed = pages.flatMap(({ body }) => body!.runs)

    expect(listed).toHaveLength(400)

    for (const run of listed) {
      const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id: run.id })}`)
      const detail = runDetailSchema.parse(await response.json())

      const orderNumber = detail.message?.segments.find(
        ({ tag, elements }) => tag === 'BGM' && elements[0]?.[0] === '220',
      )?.elements[1]?.[0]

      const orderReference = detail.message?.segments.find(
        ({ tag, elements }) => tag === 'RFF' && elements[0]?.[0] === 'ON',
      )?.elements[0]?.[1]

      expect(run.direction).toBe(detail.direction)
      expect(run.businessReference).toBe(detail.businessReference)
      expect(run.interchange).toEqual(
        detail.interchange && {
          id: detail.interchange.id,
          controlReference: detail.interchange.controlReference,
        },
      )

      if (detail.message && run.messageType !== 'CONTRL') {
        expect(orderNumber ?? orderReference).toBe(run.businessReference)
      }
    }
  }, 15_000)

  it('has no Business Reference for a CONTRL and no Interchange for an outbound Run that failed at mapping', async () => {
    const contrl = createRun({ messageType: 'CONTRL' })

    const unmapped = createRun({
      messageType: 'INVOIC',
      status: 'failed',
      failureStage: 'mapping',
    })

    server.use(runsHandler(apiUrl, [contrl, unmapped]))
    const { body } = await listRuns()

    expect(body?.runs.find(({ id }) => id === contrl.id)).toMatchObject({
      direction: 'inbound',
      businessReference: null,
    })
    expect(body?.runs.find(({ id }) => id === unmapped.id)).toMatchObject({
      direction: 'outbound',
      interchange: null,
    })
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
