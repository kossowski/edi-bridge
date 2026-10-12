import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type RunSummary,
  toPath,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
} from '@edi-bridge/contracts'

import { seedChannels } from './channel'
import { seedFlows } from './flow'
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

const desadvFlow = { id: '20000000-0000-4000-8000-000000000003', name: 'Hansemarkt DESADV' }

const flows = [ordersFlow, invoicFlow, desadvFlow].map((flow) => ({
  ...flow,
  tradingPartnerId: hansemarkt.id,
}))

const channels = [
  { tradingPartnerId: hansemarkt.id },
  { tradingPartnerId: hansemarkt.id },
  { tradingPartnerId: null },
]

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
  it('counts the Runs of today, the open problems, the last activity and the setup per partner', async () => {
    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt, rheinkauf],
        runs,
        overdueAcknowledgements: [overdue],
        flows,
        channels,
      }),
    )

    expect(await listActivities()).toEqual([
      {
        tradingPartnerId: hansemarkt.id,
        runsToday: 3,
        openProblems: 4,
        lastActivityAt: '2026-10-10T11:30:00.000Z',
        channelCount: 2,
        flowCount: 3,
      },
      {
        tradingPartnerId: rheinkauf.id,
        runsToday: 0,
        openProblems: 0,
        lastActivityAt: null,
        channelCount: 0,
        flowCount: 0,
      },
    ])
  })

  it('gives the partners with Runs a Channel and their Flows in the large-volume state', async () => {
    server.use(...tradingPartnerActivityHandlers(apiUrl, 'large'))

    const active = (await listActivities()).filter(({ lastActivityAt }) => lastActivityAt !== null)

    expect(active.length).toBeGreaterThan(0)
    expect(active.every(({ channelCount, flowCount }) => channelCount > 0 && flowCount > 0)).toBe(
      true,
    )
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

    server.use(...tradingPartnerActivityHandlers(apiUrl, { ...data, flows: [], channels: [] }))

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
        flows,
        channels,
      }),
    )

    const activity = await activityOf(hansemarkt.id)

    expect(activity.days).toEqual([
      { date: '2026-10-04', runs: 1, failed: 1 },
      { date: '2026-10-05', runs: 0, failed: 0 },
      { date: '2026-10-06', runs: 0, failed: 0 },
      { date: '2026-10-07', runs: 0, failed: 0 },
      { date: '2026-10-08', runs: 0, failed: 0 },
      { date: '2026-10-09', runs: 1, failed: 0 },
      { date: '2026-10-10', runs: 3, failed: 1 },
    ])

    expect(activity.flows).toEqual([
      { flow: ordersFlow, runs: 4 },
      { flow: invoicFlow, runs: 1 },
      { flow: desadvFlow, runs: 0 },
    ])
  })

  it('lists the open problems newest first, failed Runs older than 7 days too', async () => {
    server.use(
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: [hansemarkt],
        runs,
        overdueAcknowledgements: [overdue],
        flows,
        channels,
      }),
    )

    const { problems, openProblems } = await activityOf(hansemarkt.id)

    expect(openProblems).toBe(4)

    expect(
      problems.map((problem) =>
        problem.kind === 'failedRun'
          ? problem.run.receivedAt
          : problem.overdueAcknowledgement.overdueSince,
      ),
    ).toEqual([
      '2026-10-10T09:00:00.000Z',
      '2026-10-10T08:00:00.000Z',
      '2026-10-04T00:00:00.000Z',
      '2026-10-03T23:59:59.999Z',
    ])
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
        flows,
        channels,
      }),
    )

    const { problems, openProblems } = await activityOf(hansemarkt.id)

    expect(openProblems).toBe(25)
    expect(problems).toHaveLength(20)
    expect(problems[0]).toMatchObject({ kind: 'failedRun', run: many[0] })
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

  it('counts the Channels and Flows of each seed Trading Partner', async () => {
    server.use(...createHandlers(apiUrl))

    const activities = await listActivities()

    expect(
      activities.map(({ tradingPartnerId, channelCount, flowCount }) => ({
        tradingPartnerId,
        channelCount,
        flowCount,
      })),
    ).toEqual(
      activities.map(({ tradingPartnerId }) => ({
        tradingPartnerId,
        channelCount: seedChannels.filter(
          (channel) => channel.tradingPartnerId === tradingPartnerId,
        ).length,
        flowCount: seedFlows.filter((flow) => flow.tradingPartnerId === tradingPartnerId).length,
      })),
    )

    expect(activities.some(({ flowCount }) => flowCount > 0)).toBe(true)
  })

  it('follows the Trading Partners of the Workspace', async () => {
    server.use(...createHandlers(apiUrl, { tradingPartners: [] }))

    expect(await listActivities()).toEqual([])
  })
})
