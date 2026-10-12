import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type RunSummary,
  toPath,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
} from '@edi-bridge/contracts'

import { createHandlers } from './index'
import { createOverdueAcknowledgement, createOverviewData } from './overview'
import { createRun } from './run'
import { createTradingPartner, seedTradingPartners } from './trading-partner'
import { tradingPartnerActivityHandlers } from './trading-partner-activity'

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

const hansemarkt = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Hansemarkt GmbH',
  gln: '0200000000011',
})

const rheinkauf = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000002',
  name: 'Rheinkauf eG',
  gln: '0200000000028',
})

const ordersFlow = { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS' }

const invoicFlow = { id: '20000000-0000-4000-8000-000000000002', name: 'Hansemarkt INVOIC' }

type Outcome =
  { status: 'delivered'; failureStage: null } | { status: 'failed'; failureStage: 'mapping' }

function run(
  receivedAt: string,
  overrides: Partial<Pick<RunSummary, 'messageType' | 'flow'>> = {},
  outcome: Outcome = { status: 'delivered', failureStage: null },
): RunSummary {
  return createRun({
    tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
    messageType: 'ORDERS',
    flow: ordersFlow,
    receivedAt,
    ...overrides,
    ...outcome,
  })
}

function failed(receivedAt: string) {
  return run(receivedAt, {}, { status: 'failed', failureStage: 'mapping' })
}

const overdue = createOverdueAcknowledgement({
  tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
  overdueSince: '2026-10-10T08:00:00.000Z',
})

const runs = [
  run('2026-10-10T00:00:00.000Z'),
  run('2026-10-10T11:30:00.000Z', { messageType: 'INVOIC', flow: invoicFlow }),
  failed('2026-10-10T09:00:00.000Z'),
  run('2026-10-09T23:59:59.999Z', { messageType: 'CONTRL' }),
  failed('2026-10-04T00:00:00.000Z'),
  failed('2026-10-03T23:59:59.999Z'),
]

async function get(path: string) {
  const response = await fetch(`${apiUrl}${path}`)
  const body: unknown = await response.json()

  return { status: response.status, body }
}

async function listActivities() {
  return tradingPartnerActivitiesEndpoint.response.parse(
    (await get(tradingPartnerActivitiesEndpoint.path)).body,
  )
}

async function activityOf(id: string) {
  return tradingPartnerActivityEndpoint.response.parse(
    (await get(toPath(tradingPartnerActivityEndpoint.path, { id }))).body,
  )
}

describe('GET /trading-partners/activity', () => {
  it('counts the documents of today, the open problems and the last activity per partner', async () => {
    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt, rheinkauf],
        runs,
        overdueAcknowledgements: [overdue],
      }),
    )

    expect(await listActivities()).toEqual([
      {
        tradingPartnerId: hansemarkt.id,
        documentsToday: 3,
        openProblems: 3,
        lastActivityAt: '2026-10-10T11:30:00.000Z',
      },
      {
        tradingPartnerId: rheinkauf.id,
        documentsToday: 0,
        openProblems: 0,
        lastActivityAt: null,
      },
    ])
  })

  it('serves an empty list', async () => {
    server.use(...tradingPartnerActivityHandlers(apiUrl, 'empty'))

    expect(await listActivities()).toEqual([])
  })

  it('answers with a server error in the error state', async () => {
    server.use(...tradingPartnerActivityHandlers(apiUrl, 'error'))

    expect((await get(tradingPartnerActivitiesEndpoint.path)).status).toBe(500)
  })

  it('serves a large volume of partners', async () => {
    const data = createOverviewData({
      tradingPartnerCount: 240,
      overdueCount: 400,
      runCount: 30_000,
      now,
    })

    server.use(...tradingPartnerActivityHandlers(apiUrl, data))

    expect(await listActivities()).toHaveLength(240)
  })
})

describe('GET /trading-partners/:id/activity', () => {
  it('breaks the last 7 days down by day and by Flow', async () => {
    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt],
        runs,
        overdueAcknowledgements: [],
      }),
    )

    const activity = await activityOf(hansemarkt.id)

    expect(activity.days).toEqual([
      { date: '2026-10-04', documents: 1, failed: 1 },
      { date: '2026-10-05', documents: 0, failed: 0 },
      { date: '2026-10-06', documents: 0, failed: 0 },
      { date: '2026-10-07', documents: 0, failed: 0 },
      { date: '2026-10-08', documents: 0, failed: 0 },
      { date: '2026-10-09', documents: 1, failed: 0 },
      { date: '2026-10-10', documents: 3, failed: 1 },
    ])

    expect(activity.flows).toEqual([
      { flow: ordersFlow, documents: 4 },
      { flow: invoicFlow, documents: 1 },
    ])

    expect(activity.lastAcknowledgementAt).toBe('2026-10-09T23:59:59.999Z')
  })

  it('lists the open problems newest first', async () => {
    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt],
        runs,
        overdueAcknowledgements: [overdue],
      }),
    )

    const { problems, openProblems } = await activityOf(hansemarkt.id)

    expect(openProblems).toBe(3)

    expect(
      problems.map((problem) =>
        problem.kind === 'failedRun'
          ? problem.run.receivedAt
          : problem.overdueAcknowledgement.overdueSince,
      ),
    ).toEqual(['2026-10-10T09:00:00.000Z', '2026-10-10T08:00:00.000Z', '2026-10-04T00:00:00.000Z'])
  })

  it('keeps the count but lists only the 20 newest problems', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      failed(new Date(now.getTime() - (index + 1) * 60_000).toISOString()),
    )

    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt],
        runs: many,
        overdueAcknowledgements: [],
      }),
    )

    const { problems, openProblems } = await activityOf(hansemarkt.id)

    expect(openProblems).toBe(25)
    expect(problems).toHaveLength(20)
  })

  it('answers 404 for an unknown Trading Partner', async () => {
    server.use(...tradingPartnerActivityHandlers(apiUrl, 'empty'))

    const { status } = await get(toPath(tradingPartnerActivityEndpoint.path, rheinkauf))

    expect(status).toBe(404)
  })
})

describe('createHandlers', () => {
  it('serves the activity of every seed Trading Partner next to the partner routes', async () => {
    server.use(...createHandlers(apiUrl))

    const activities = await listActivities()

    expect(activities.map(({ tradingPartnerId }) => tradingPartnerId).sort()).toEqual(
      seedTradingPartners.map(({ id }) => id).sort(),
    )
  })

  it('follows the Trading Partners of the Workspace', async () => {
    server.use(...createHandlers(apiUrl, { tradingPartners: [] }))

    expect(await listActivities()).toEqual([])
  })
})
