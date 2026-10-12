import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type TradingPartner, tasksEndpoint, tasksSchema } from '@edi-bridge/contracts'

import { createOverdueAcknowledgement } from './overdue-acknowledgement'
import { createRun } from './run'
import { createRunStore } from './run-store'
import { createTasksData, emptyTasksData, type TasksData, tasksHandler } from './task'
import { createTradingPartner } from './trading-partner'

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

async function getTasks() {
  const response = await fetch(`${apiUrl}${tasksEndpoint.path}`)

  return tasksSchema.parse(await response.json())
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

const summaryOf = ({ id, name }: TradingPartner) => ({ id, name })

function delivered(receivedAt: string, tradingPartner = rheinkauf) {
  return createRun({
    tradingPartner: summaryOf(tradingPartner),
    status: 'delivered',
    failureStage: null,
    receivedAt,
  })
}

function data(overrides: Partial<TasksData>): TasksData {
  return { ...emptyTasksData, ...overrides }
}

describe('GET /tasks', () => {
  it('lists the failed Runs of the last 24 hours by who acts, linked to the Run', async () => {
    const retry = createRun({
      tradingPartner: summaryOf(rheinkauf),
      messageType: 'INVOIC',
      status: 'failed',
      failureStage: 'delivery',
      receivedAt: '2026-10-10T11:00:00.000Z',
    })

    const tradingPartner = createRun({
      tradingPartner: summaryOf(rheinkauf),
      messageType: 'ORDERS',
      status: 'failed',
      failureStage: 'parse',
      receivedAt: '2026-10-10T10:00:00.000Z',
    })

    const older = createRun({
      tradingPartner: summaryOf(rheinkauf),
      status: 'failed',
      failureStage: 'mapping',
      receivedAt: '2026-10-09T12:19:59.999Z',
    })

    const replaced = createRun({
      tradingPartner: summaryOf(rheinkauf),
      status: 'failed',
      failureStage: 'mapping',
      receivedAt: '2026-10-10T09:00:00.000Z',
    })

    const healthy = Array.from({ length: 10 }, () => delivered('2026-10-10T08:00:00.000Z'))

    server.use(
      tasksHandler(
        apiUrl,
        data({
          runs: createRunStore(
            [retry, tradingPartner, older, replaced, ...healthy],
            [{ replaced: replaced.id, replacing: healthy[0]!.id }],
          ),
          tradingPartners: [rheinkauf],
        }),
      ),
    )

    const { tasks, counts } = await getTasks()

    expect(tasks).toEqual([
      {
        id: `run:${retry.id}`,
        kind: 'failedRun',
        whoActs: 'retry',
        tradingPartner: summaryOf(rheinkauf),
        at: retry.receivedAt,
        run: { id: retry.id, messageType: 'INVOIC', failureStage: 'delivery' },
        target: { kind: 'run', runId: retry.id },
      },
      expect.objectContaining({ id: `run:${tradingPartner.id}`, whoActs: 'tradingPartner' }),
    ])
    expect(counts).toEqual({ you: 0, retry: 1, tradingPartner: 1 })
  })

  it('drops a failed Run once a Reprocess replaces it', async () => {
    const failed = createRun({
      tradingPartner: summaryOf(rheinkauf),
      status: 'failed',
      failureStage: 'mapping',
      receivedAt: '2026-10-10T11:00:00.000Z',
    })

    const replacing = delivered('2026-10-10T12:00:00.000Z')
    const runs = createRunStore([failed, replacing])

    server.use(tasksHandler(apiUrl, data({ runs })))

    expect((await getTasks()).tasks.map(({ id }) => id)).toEqual([`run:${failed.id}`])

    runs.reprocess({ replaced: failed.id, replacing: replacing.id })

    expect((await getTasks()).tasks).toEqual([])
  })

  it('waits for the Trading Partner on an Overdue Acknowledgement, linked to its Interchange', async () => {
    const acknowledgement = createOverdueAcknowledgement({
      tradingPartner: summaryOf(hansemarkt),
      overdueSince: '2026-10-10T06:00:00.000Z',
    })

    server.use(tasksHandler(apiUrl, data({ overdueAcknowledgements: [acknowledgement] })))

    const { tasks, counts } = await getTasks()

    expect(tasks).toEqual([
      {
        id: `overdue:${acknowledgement.interchange.id}`,
        kind: 'overdueAcknowledgement',
        whoActs: 'tradingPartner',
        tradingPartner: summaryOf(hansemarkt),
        at: '2026-10-10T06:00:00.000Z',
        interchange: acknowledgement.interchange,
        messageType: acknowledgement.messageType,
        sentAt: acknowledgement.sentAt,
        acknowledgementTimeLimitHours: acknowledgement.acknowledgementTimeLimitHours,
        target: {
          kind: 'interchange',
          controlReference: acknowledgement.interchange.controlReference,
        },
      },
    ])
    expect(counts).toEqual({ you: 0, retry: 0, tradingPartner: 1 })
  })

  it('flags a failing Trading Partner, linked to the Trading Partner', async () => {
    const failing = Array.from({ length: 3 }, (_, index) =>
      createRun({
        tradingPartner: summaryOf(hansemarkt),
        status: 'failed',
        failureStage: 'delivery',
        receivedAt: `2026-10-10T0${index + 1}:00:00.000Z`,
      }),
    )

    server.use(
      tasksHandler(
        apiUrl,
        data({
          runs: [...failing, delivered('2026-10-10T05:00:00.000Z', hansemarkt)],
          tradingPartners: [hansemarkt, rheinkauf],
        }),
      ),
    )

    const { tasks, counts } = await getTasks()

    expect(tasks[0]).toEqual({
      id: `tradingPartner:${hansemarkt.id}`,
      kind: 'failingTradingPartner',
      whoActs: 'retry',
      tradingPartner: summaryOf(hansemarkt),
      at: '2026-10-10T05:00:00.000Z',
      delivered: 1,
      failed: 3,
      target: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id },
    })
    expect(tasks.map(({ at }) => at)).toEqual([
      '2026-10-10T05:00:00.000Z',
      '2026-10-10T03:00:00.000Z',
      '2026-10-10T02:00:00.000Z',
      '2026-10-10T01:00:00.000Z',
    ])
    expect(counts).toEqual({ you: 0, retry: 4, tradingPartner: 0 })
  })

  it.each([
    [['parse', 'parse', 'delivery'], 'tradingPartner'],
    [['delivery', 'delivery', 'mapping'], 'retry'],
    [['mapping', 'mapping', 'parse'], 'you'],
    [['parse', 'delivery', 'mapping'], 'you'],
    [['parse', 'parse', 'delivery', 'delivery'], 'you'],
  ] as const)(
    'gives a Trading Partner whose Runs failed at %j to the most frequent who acts: %s',
    async (failureStages, whoActs) => {
      const failing = failureStages.map((failureStage, index) =>
        createRun({
          tradingPartner: summaryOf(hansemarkt),
          messageType: 'ORDERS',
          status: 'failed',
          failureStage,
          receivedAt: `2026-10-10T0${index + 1}:00:00.000Z`,
        }),
      )

      server.use(tasksHandler(apiUrl, data({ runs: failing, tradingPartners: [hansemarkt] })))

      const { tasks } = await getTasks()

      expect(tasks.find(({ kind }) => kind === 'failingTradingPartner')).toEqual(
        expect.objectContaining({ whoActs }),
      )
    },
  )

  it('has nothing to do when all is good', async () => {
    server.use(tasksHandler(apiUrl, 'empty'))

    expect(await getTasks()).toEqual({ tasks: [], counts: { you: 0, retry: 0, tradingPartner: 0 } })
  })

  it('serves a large volume of tasks for every kind', async () => {
    server.use(tasksHandler(apiUrl, 'large'))

    const { tasks, counts } = await getTasks()

    expect(tasks.length).toBeGreaterThan(500)
    expect(new Set(tasks.map(({ kind }) => kind))).toEqual(
      new Set(['failedRun', 'overdueAcknowledgement', 'failingTradingPartner']),
    )
    expect(counts.you + counts.retry + counts.tradingPartner).toBe(tasks.length)
  })

  it('serves the seeded tasks', async () => {
    server.use(tasksHandler(apiUrl))

    const { tasks } = await getTasks()

    expect(tasks.length).toBeGreaterThan(0)
  })

  it('fails when asked', async () => {
    server.use(tasksHandler(apiUrl, 'error'))

    const response = await fetch(`${apiUrl}${tasksEndpoint.path}`)

    expect(response.status).toBe(500)
  })
})

describe('createTasksData', () => {
  it('falls back to any Trading Partner in production when none drew an overdue profile', () => {
    const { tradingPartners, overdueAcknowledgements } = createTasksData({
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
    const { tradingPartners, overdueAcknowledgements } = createTasksData({
      tradingPartnerCount: 1,
      overdueCount: 3,
      runCount: 0,
      seed: 4,
    })

    expect(tradingPartners[0]?.testMode).toBe(true)
    expect(overdueAcknowledgements).toEqual([])
  })
})
