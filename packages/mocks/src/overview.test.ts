import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  interchangeEndpoint,
  overviewEndpoint,
  type OverviewQuery,
  overviewSchema,
  toPath,
  toSearchParams,
  type TradingPartner,
} from '@edi-bridge/contracts'

import {
  createOverdueAcknowledgement,
  createOverviewData,
  emptyOverviewData,
  overviewHandler,
} from './overview'
import { createRun } from './run'
import { runDetailHandlers } from './run-detail'
import { createTradingPartner, seedTradingPartners } from './trading-partner'

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

async function getOverview(query: Partial<OverviewQuery> = {}) {
  const response = await fetch(`${apiUrl}${overviewEndpoint.path}?${toSearchParams(query)}`)

  return overviewSchema.parse(await response.json())
}

describe('GET /overview', () => {
  it('counts delivered and failed Runs per hour over the last 24 hours', async () => {
    server.use(
      overviewHandler(apiUrl, {
        runs: [
          createRun({
            status: 'delivered',
            failureStage: null,
            receivedAt: '2026-10-10T12:05:00.000Z',
          }),
          createRun({
            status: 'delivered',
            failureStage: null,
            receivedAt: '2026-10-10T12:15:00.000Z',
          }),
          createRun({
            status: 'failed',
            failureStage: 'mapping',
            receivedAt: '2026-10-10T11:59:59.999Z',
          }),
          createRun({
            status: 'duplicate',
            failureStage: null,
            receivedAt: '2026-10-10T12:10:00.000Z',
          }),
          createRun({
            status: 'delivered',
            failureStage: null,
            receivedAt: '2026-10-09T12:59:59.999Z',
          }),
        ],
        tradingPartners: [],
        overdueAcknowledgements: [],
      }),
    )

    const overview = await getOverview()

    expect(overview.window).toBe('24h')
    expect(overview.from).toBe('2026-10-09T13:00:00.000Z')
    expect(overview.to).toBe('2026-10-10T13:00:00.000Z')
    expect(overview.throughput).toHaveLength(24)
    expect(overview.throughput.at(-1)).toEqual({
      start: '2026-10-10T12:00:00.000Z',
      end: '2026-10-10T13:00:00.000Z',
      delivered: 2,
      failed: 0,
    })
    expect(overview.throughput.at(-2)).toMatchObject({ delivered: 0, failed: 1 })
    expect(overview.throughput.reduce((sum, bucket) => sum + bucket.delivered, 0)).toBe(2)
  })

  it.each([
    ['1h', 12, '2026-10-10T11:25:00.000Z', '2026-10-10T12:25:00.000Z'],
    ['7d', 28, '2026-10-03T18:00:00.000Z', '2026-10-10T18:00:00.000Z'],
  ] as const)('splits the %s window into %i buckets', async (window, count, from, to) => {
    server.use(overviewHandler(apiUrl, emptyOverviewData))

    const overview = await getOverview({ window })

    expect(overview.throughput).toHaveLength(count)
    expect(overview.throughput[0]?.start).toBe(from)
    expect(overview.throughput.at(-1)?.end).toBe(to)
  })

  it('rejects an unknown window', async () => {
    server.use(overviewHandler(apiUrl, emptyOverviewData))

    const response = await fetch(`${apiUrl}${overviewEndpoint.path}?window=30d`)

    expect(response.status).toBe(400)
  })

  it('rates each Trading Partner by its Runs in the window and lists the worst first', async () => {
    const [hansemarkt, rheinkauf, elbtal] = [
      createTradingPartner({ id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }),
      createTradingPartner({ id: '10000000-0000-4000-8000-000000000003', name: 'Rheinkauf eG' }),
      createTradingPartner({
        id: '10000000-0000-4000-8000-000000000004',
        name: 'Elbtal Warenhaus KG',
      }),
    ] as const

    const runOf = (
      { id, name }: TradingPartner,
      receivedAt: string,
      status: 'delivered' | 'failed' = 'delivered',
    ) =>
      createRun({
        tradingPartner: { id, name },
        receivedAt,
        ...(status === 'failed'
          ? { status, failureStage: 'delivery' }
          : { status, failureStage: null }),
      })

    server.use(
      overviewHandler(apiUrl, {
        runs: [
          runOf(hansemarkt, '2026-10-10T09:00:00.000Z'),
          runOf(hansemarkt, '2026-10-10T10:00:00.000Z'),
          runOf(rheinkauf, '2026-10-10T08:00:00.000Z'),
          runOf(rheinkauf, '2026-10-10T11:30:00.000Z', 'failed'),
          runOf(elbtal, '2026-10-01T07:00:00.000Z'),
        ],
        tradingPartners: [hansemarkt, rheinkauf, elbtal],
        overdueAcknowledgements: [
          createOverdueAcknowledgement({
            tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
          }),
        ],
      }),
    )

    const overview = await getOverview()

    expect(overview.tradingPartners).toEqual([
      {
        tradingPartner: { id: rheinkauf.id, name: 'Rheinkauf eG' },
        status: 'failing',
        delivered: 1,
        failed: 1,
        overdue: 0,
        lastRunAt: '2026-10-10T11:30:00.000Z',
      },
      {
        tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt GmbH' },
        status: 'degraded',
        delivered: 2,
        failed: 0,
        overdue: 1,
        lastRunAt: '2026-10-10T10:00:00.000Z',
      },
      {
        tradingPartner: { id: elbtal.id, name: 'Elbtal Warenhaus KG' },
        status: 'healthy',
        delivered: 0,
        failed: 0,
        overdue: 0,
        lastRunAt: '2026-10-01T07:00:00.000Z',
      },
    ])
  })

  it('lists every Overdue Acknowledgement, the longest overdue first, whatever the window', async () => {
    const overdueSince = [
      '2026-10-10T09:00:00.000Z',
      '2026-10-07T09:00:00.000Z',
      '2026-10-10T11:00:00.000Z',
    ]

    server.use(
      overviewHandler(apiUrl, {
        ...emptyOverviewData,
        overdueAcknowledgements: overdueSince.map((since) =>
          createOverdueAcknowledgement({ overdueSince: since }),
        ),
      }),
    )

    const overview = await getOverview({ window: '1h' })

    expect(overview.overdueAcknowledgements.map((item) => item.overdueSince)).toEqual([
      '2026-10-07T09:00:00.000Z',
      '2026-10-10T09:00:00.000Z',
      '2026-10-10T11:00:00.000Z',
    ])
  })
})

describe('GET /overview states', () => {
  it('serves an empty Overview with a zero for every bucket', async () => {
    server.use(overviewHandler(apiUrl, 'empty'))

    const overview = await getOverview()

    expect(overview.throughput).toHaveLength(24)
    expect(overview.throughput.every(({ delivered, failed }) => delivered + failed === 0)).toBe(
      true,
    )
    expect(overview.tradingPartners).toEqual([])
    expect(overview.overdueAcknowledgements).toEqual([])
  })

  it('keeps the request pending in the loading state', async () => {
    server.use(overviewHandler(apiUrl, 'loading'))

    await expect(
      fetch(`${apiUrl}${overviewEndpoint.path}`, { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow()
  })

  it('serves a large volume of Trading Partners and Overdue Acknowledgements in every health status', async () => {
    server.use(overviewHandler(apiUrl, 'large'))

    const overview = await getOverview({ window: '7d' })
    const listed = new Set(overview.tradingPartners.map(({ tradingPartner }) => tradingPartner.id))

    expect(overview.tradingPartners.length).toBeGreaterThanOrEqual(200)
    expect(new Set(overview.tradingPartners.map(({ status }) => status))).toEqual(
      new Set(['healthy', 'degraded', 'failing']),
    )
    expect(overview.overdueAcknowledgements.length).toBeGreaterThanOrEqual(200)
    expect(
      overview.overdueAcknowledgements.every(({ tradingPartner }) => listed.has(tradingPartner.id)),
    ).toBe(true)
    expect(overview.throughput.every(({ delivered }) => delivered > 0)).toBe(true)
  })

  it('answers with a server error in the error state', async () => {
    server.use(overviewHandler(apiUrl, 'error'))

    const response = await fetch(`${apiUrl}${overviewEndpoint.path}`)

    expect(response.status).toBe(500)
  })
})

describe('GET /overview seeded', () => {
  it('rates every seeded Trading Partner', async () => {
    vi.useRealTimers()
    server.use(overviewHandler(apiUrl))

    const overview = await getOverview()

    expect(overview.tradingPartners.map(({ tradingPartner }) => tradingPartner.id).sort()).toEqual(
      seedTradingPartners.map(({ id }) => id).sort(),
    )
    expect(overview.throughput.some(({ delivered }) => delivered > 0)).toBe(true)
  })

  it('links each Overdue Acknowledgement to the sent Interchange after the time limit of its Trading Partner', async () => {
    vi.useRealTimers()
    server.use(overviewHandler(apiUrl), ...runDetailHandlers(apiUrl))

    const { overdueAcknowledgements } = await getOverview()

    expect(overdueAcknowledgements.length).toBeGreaterThan(0)

    for (const overdue of overdueAcknowledgements) {
      const tradingPartner = seedTradingPartners.find(({ id }) => id === overdue.tradingPartner.id)

      const response = await fetch(
        `${apiUrl}${toPath(interchangeEndpoint.path, { id: overdue.interchange.id })}`,
      )

      const interchange = interchangeEndpoint.response.parse(await response.json())

      expect(interchange.direction).toBe('outbound')
      expect(interchange.controlReference).toBe(overdue.interchange.controlReference)
      expect(interchange.runs[0]?.tradingPartner.id).toBe(overdue.tradingPartner.id)
      expect(interchange.runs[0]?.messageType).toBe(overdue.messageType)
      expect(tradingPartner?.testMode).toBe(false)
      expect(overdue.acknowledgementTimeLimitHours).toBe(
        tradingPartner?.acknowledgementTimeLimitHours,
      )
      expect(Date.parse(overdue.overdueSince) - Date.parse(overdue.sentAt)).toBe(
        overdue.acknowledgementTimeLimitHours * 60 * 60 * 1000,
      )
      expect(Date.parse(overdue.overdueSince)).toBeLessThanOrEqual(Date.now())
    }
  })
  it('lists the sent Interchanges that became Overdue since the last request', async () => {
    vi.useRealTimers()
    server.use(overviewHandler(apiUrl))

    const before = await getOverview()
    const later = Date.now() + 24 * 60 * 60 * 1000
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(later)

    const after = await getOverview()

    const listedBefore = new Set(
      before.overdueAcknowledgements.map(({ interchange }) => interchange.id),
    )

    expect(
      after.overdueAcknowledgements.some(({ interchange }) => !listedBefore.has(interchange.id)),
    ).toBe(true)
    expect(
      after.overdueAcknowledgements.every(({ overdueSince }) => Date.parse(overdueSince) <= later),
    ).toBe(true)
  })
})

describe('createOverviewData', () => {
  it('falls back to any Trading Partner in production when none drew an overdue profile', () => {
    const { tradingPartners, overdueAcknowledgements } = createOverviewData({
      tradingPartnerCount: 1,
      overdueCount: 3,
      runCount: 0,
      seed: 1,
    })

    expect(tradingPartners[0]?.testMode).toBe(false)
    expect(overdueAcknowledgements.map(({ tradingPartner }) => tradingPartner.id)).toEqual(
      Array(3).fill(tradingPartners[0]?.id),
    )
  })

  it('leaves Test Mode Trading Partners without Overdue Acknowledgements', () => {
    const { tradingPartners, overdueAcknowledgements } = createOverviewData({
      tradingPartnerCount: 1,
      overdueCount: 3,
      runCount: 0,
      seed: 4,
    })

    expect(tradingPartners[0]?.testMode).toBe(true)
    expect(overdueAcknowledgements).toEqual([])
  })
})
