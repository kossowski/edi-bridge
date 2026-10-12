import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  homeEndpoint,
  type HomeQuery,
  homeSchema,
  tasksEndpoint,
  tasksSchema,
  toSearchParams,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { homeHandler } from './home'
import { createOverdueAcknowledgement } from './overdue-acknowledgement'
import { createRun } from './run'
import { tasksHandler } from './task'
import { createTradingPartner, seedTradingPartners } from './trading-partner'
import { emptyWorkspaceActivity, type WorkspaceActivity } from './workspace-activity'

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

async function getHome(query: Partial<HomeQuery> = {}) {
  const response = await fetch(`${apiUrl}${homeEndpoint.path}?${toSearchParams(query)}`)

  return homeSchema.parse(await response.json())
}

const hansemarkt = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Hansemarkt GmbH',
  testMode: false,
})

const rheinkauf = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000003',
  name: 'Rheinkauf eG',
  testMode: false,
})

const elbtal = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000004',
  name: 'Elbtal Warenhaus KG',
  testMode: true,
})

const summaryOf = ({ id, name }: TradingPartner) => ({ id, name })

function delivered(receivedAt: string, tradingPartner = rheinkauf) {
  return createRun({
    tradingPartner: summaryOf(tradingPartner),
    status: 'delivered',
    failureStage: null,
    receivedAt,
  })
}

function data(overrides: Partial<WorkspaceActivity>): WorkspaceActivity {
  return { ...emptyWorkspaceActivity, ...overrides }
}

describe('GET /home', () => {
  it('counts delivered and failed Runs per hour over the last 24 hours', async () => {
    server.use(
      homeHandler(
        apiUrl,
        data({
          runs: [
            delivered('2026-10-10T12:05:00.000Z'),
            delivered('2026-10-10T12:15:00.000Z'),
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
            delivered('2026-10-09T12:59:59.999Z'),
          ],
        }),
      ),
    )

    const home = await getHome()

    expect(home.window).toBe('24h')
    expect(home.from).toBe('2026-10-09T13:00:00.000Z')
    expect(home.to).toBe('2026-10-10T13:00:00.000Z')
    expect(home.throughput).toHaveLength(24)
    expect(home.throughput.at(-1)).toEqual({
      start: '2026-10-10T12:00:00.000Z',
      end: '2026-10-10T13:00:00.000Z',
      delivered: 2,
      failed: 0,
    })
    expect(home.throughput.at(-2)).toMatchObject({ delivered: 0, failed: 1 })
    expect(home.keyNumbers.delivered).toBe(2)
  })

  it.each([
    ['7d', 7, '2026-10-04T00:00:00.000Z', '2026-10-11T00:00:00.000Z'],
    ['30d', 30, '2026-09-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'],
  ] as const)('splits the %s window into %i daily buckets', async (window, count, from, to) => {
    server.use(homeHandler(apiUrl, data({ runs: [delivered('2026-10-05T08:00:00.000Z')] })))

    const home = await getHome({ window })

    expect(home.throughput).toHaveLength(count)
    expect(home.throughput[0]?.start).toBe(from)
    expect(home.throughput.at(-1)?.end).toBe(to)
    expect(home.keyNumbers.delivered).toBe(1)
  })

  it('rejects an unknown window', async () => {
    server.use(homeHandler(apiUrl, 'empty'))

    const response = await fetch(`${apiUrl}${homeEndpoint.path}?window=1h`)

    expect(response.status).toBe(400)
  })

  it('counts open tasks and Runs in progress the same way as the lists they open', async () => {
    const tasksData = data({
      tradingPartners: [hansemarkt, rheinkauf],
      runs: [
        createRun({
          tradingPartner: summaryOf(hansemarkt),
          messageType: 'INVOIC',
          status: 'failed',
          failureStage: 'delivery',
          receivedAt: '2026-10-10T11:00:00.000Z',
        }),
        createRun({
          tradingPartner: summaryOf(hansemarkt),
          messageType: 'DESADV',
          status: 'failed',
          failureStage: 'mapping',
          receivedAt: '2026-10-10T10:00:00.000Z',
        }),
        createRun({
          tradingPartner: summaryOf(rheinkauf),
          status: 'processing',
          failureStage: null,
          receivedAt: '2026-10-10T12:19:00.000Z',
        }),
        createRun({
          tradingPartner: summaryOf(rheinkauf),
          status: 'received',
          failureStage: null,
          receivedAt: '2026-09-01T12:00:00.000Z',
        }),
        ...Array.from({ length: 10 }, () => delivered('2026-10-10T08:00:00.000Z')),
      ],
      overdueAcknowledgements: [
        createOverdueAcknowledgement({ tradingPartner: summaryOf(rheinkauf) }),
      ],
    })

    server.use(homeHandler(apiUrl, tasksData), tasksHandler(apiUrl, tasksData))

    const home = await getHome({ window: '7d' })
    const tasks = tasksSchema.parse(await (await fetch(`${apiUrl}${tasksEndpoint.path}`)).json())

    expect(home.keyNumbers).toEqual({
      needsAttention: tasks.counts.you + tasks.counts.retry,
      delivered: 10,
      inProgress: 2,
      waitingForTradingPartner: tasks.counts.tradingPartner,
    })
    expect(home.keyNumbers.needsAttention).toBeGreaterThan(0)
    expect(home.keyNumbers.waitingForTradingPartner).toBeGreaterThan(0)
  })

  it('shows each Trading Partner with its mode, documents today and open problems, most problems first', async () => {
    server.use(
      homeHandler(
        apiUrl,
        data({
          tradingPartners: [elbtal, hansemarkt, rheinkauf],
          runs: [
            delivered('2026-10-10T09:00:00.000Z', hansemarkt),
            delivered('2026-10-10T10:00:00.000Z', hansemarkt),
            delivered('2026-10-09T23:59:59.999Z', hansemarkt),
            delivered('2026-10-10T00:00:00.000Z', elbtal),
          ],
          overdueAcknowledgements: [
            createOverdueAcknowledgement({ tradingPartner: summaryOf(rheinkauf) }),
          ],
        }),
      ),
    )

    const { tradingPartners } = await getHome()

    expect(tradingPartners).toEqual([
      {
        tradingPartner: summaryOf(rheinkauf),
        testMode: false,
        documentsToday: 0,
        openProblems: 1,
      },
      {
        tradingPartner: summaryOf(hansemarkt),
        testMode: false,
        documentsToday: 2,
        openProblems: 0,
      },
      {
        tradingPartner: summaryOf(elbtal),
        testMode: true,
        documentsToday: 1,
        openProblems: 0,
      },
    ])
  })
})

describe('GET /home states', () => {
  it('serves an empty Home with a zero for every bucket', async () => {
    server.use(homeHandler(apiUrl, 'empty'))

    const home = await getHome({ window: '30d' })

    expect(home.throughput).toHaveLength(30)
    expect(home.throughput.every(({ delivered, failed }) => delivered + failed === 0)).toBe(true)
    expect(home.keyNumbers).toEqual({
      needsAttention: 0,
      delivered: 0,
      inProgress: 0,
      waitingForTradingPartner: 0,
    })
    expect(home.tradingPartners).toEqual([])
  })

  it('keeps the request pending in the loading state', async () => {
    server.use(homeHandler(apiUrl, 'loading'))

    await expect(
      fetch(`${apiUrl}${homeEndpoint.path}`, { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow()
  })

  it('serves a large volume with traffic in every bucket', async () => {
    server.use(homeHandler(apiUrl, 'large'))

    const home = await getHome({ window: '30d' })

    expect(home.tradingPartners.length).toBeGreaterThanOrEqual(200)
    expect(home.tradingPartners.some(({ testMode }) => testMode)).toBe(true)
    expect(home.tradingPartners.some(({ openProblems }) => openProblems > 0)).toBe(true)
    expect(home.throughput.every(({ delivered }) => delivered > 0)).toBe(true)
    expect(home.keyNumbers.needsAttention).toBeGreaterThan(0)
    expect(home.keyNumbers.inProgress).toBeGreaterThan(0)
  })

  it('answers with a server error in the error state', async () => {
    server.use(homeHandler(apiUrl, 'error'))

    const response = await fetch(`${apiUrl}${homeEndpoint.path}`)

    expect(response.status).toBe(500)
  })
})

describe('GET /home seeded', () => {
  it('shows every seeded Trading Partner and traffic in the window', async () => {
    vi.useRealTimers()
    server.use(homeHandler(apiUrl))

    const home = await getHome({ window: '7d' })

    expect(home.tradingPartners.map(({ tradingPartner }) => tradingPartner.id).sort()).toEqual(
      seedTradingPartners.map(({ id }) => id).sort(),
    )
    expect(home.throughput.some(({ delivered }) => delivered > 0)).toBe(true)
  })
})
