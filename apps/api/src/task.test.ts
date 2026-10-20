import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Task, tasksEndpoint, tasksSchema } from '@edi-bridge/contracts'
import { type InvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { hourMs } from './duration.js'
import {
  addTradingPartnerWithFlows,
  type Client,
  failedRun,
  seedWorkspaceWithAdmin,
  startTestApi,
  type TestApi,
} from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

const now = Date.now()

const hoursAgo = (hours: number) => new Date(now - hours * hourMs)

const addTradingPartner = (target: InvoiceWorkspace, name: string) =>
  addTradingPartnerWithFlows(api.connection.db, target, name)

beforeAll(async () => {
  api = await startTestApi()
  ;({ workspace, admin } = await seedWorkspaceWithAdmin(api, 'Nordwind Foods'))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listed = async (as = admin) => {
  const response = await as.inject({ method: tasksEndpoint.method, url: tasksEndpoint.path })

  expect(response.statusCode).toBe(200)

  return tasksSchema.parse(response.json())
}

const ofTradingPartner = (tasks: readonly Task[], tradingPartnerId: string, kind: Task['kind']) =>
  tasks.filter((task) => task.tradingPartner.id === tradingPartnerId && task.kind === kind)

describe('GET /tasks', () => {
  it('lists the failed Runs of the last 24 hours by who acts, linked to the Run', async () => {
    const partner = await addTradingPartner(workspace, 'Rheinkauf eG')

    const delivery = await partner.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(1) })
    const mapping = await partner.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(2) })
    const inboundParse = await partner.orders({ ...failedRun('parse'), receivedAt: hoursAgo(3) })

    const outboundValidation = await partner.invoic({
      ...failedRun('validation'),
      receivedAt: hoursAgo(4),
    })

    const waiting = await partner.orders({
      ...failedRun('mapping'),
      waitingForTradingPartnerSince: hoursAgo(4),
      receivedAt: hoursAgo(5),
    })

    await partner.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(25) })
    const reprocessed = await partner.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(6) })
    await partner.orders({ replacesRunId: reprocessed.id, receivedAt: hoursAgo(5.5) })

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, partner.tradingPartner.id, 'failedRun')).toEqual([
      {
        id: `run:${delivery.id}`,
        kind: 'failedRun',
        whoActs: 'retry',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(1).toISOString(),
        run: { id: delivery.id, messageType: 'INVOIC', failureStage: 'delivery' },
        target: { kind: 'run', runId: delivery.id },
      },
      {
        id: `run:${mapping.id}`,
        kind: 'failedRun',
        whoActs: 'you',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(2).toISOString(),
        run: { id: mapping.id, messageType: 'ORDERS', failureStage: 'mapping' },
        target: { kind: 'run', runId: mapping.id },
      },
      {
        id: `run:${inboundParse.id}`,
        kind: 'failedRun',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(3).toISOString(),
        run: { id: inboundParse.id, messageType: 'ORDERS', failureStage: 'parse' },
        target: { kind: 'run', runId: inboundParse.id },
      },
      {
        id: `run:${outboundValidation.id}`,
        kind: 'failedRun',
        whoActs: 'you',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(4).toISOString(),
        run: { id: outboundValidation.id, messageType: 'INVOIC', failureStage: 'validation' },
        target: { kind: 'run', runId: outboundValidation.id },
      },
      {
        id: `run:${waiting.id}`,
        kind: 'failedRun',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(5).toISOString(),
        run: { id: waiting.id, messageType: 'ORDERS', failureStage: 'mapping' },
        target: { kind: 'run', runId: waiting.id },
      },
    ])
  })

  it('lists the Overdue Acknowledgements, linked to the Interchange', async () => {
    const partner = await addTradingPartner(workspace, 'Ostsee Handel KG')

    const sent = { status: 'delivered' as const, receivedAt: hoursAgo(31) }

    const overdue = await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(30),
      controlReference: 17,
      acknowledgementState: 'overdue',
    })

    await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(2),
      controlReference: 18,
      acknowledgementState: 'pending',
    })
    await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(30),
      controlReference: 19,
      acknowledgementState: 'accepted',
    })

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, partner.tradingPartner.id, 'overdueAcknowledgement')).toEqual([
      {
        id: `overdue:${overdue.id}`,
        kind: 'overdueAcknowledgement',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(6).toISOString(),
        interchange: { id: overdue.id, controlReference: '17' },
        messageType: 'INVOIC',
        sentAt: hoursAgo(30).toISOString(),
        acknowledgementTimeLimitHours: 24,
        target: { kind: 'interchange', controlReference: '17' },
      },
    ])
  })

  it('lists a failing Trading Partner by who acts on most of its failed Runs', async () => {
    const failing = await addTradingPartner(workspace, 'Alpenfrisch Märkte AG')

    await failing.invoic({ receivedAt: hoursAgo(10) })
    await failing.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(9) })
    await failing.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(8) })
    await failing.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(7) })
    await failing.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(30) })
    await failing.orders({ receivedAt: hoursAgo(3) })

    const degraded = await addTradingPartner(workspace, 'Baltic Frische GmbH')

    await degraded.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(5) })

    for (const hours of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await degraded.orders({ receivedAt: hoursAgo(hours) })
    }

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, failing.tradingPartner.id, 'failingTradingPartner')).toEqual([
      {
        id: `tradingPartner:${failing.tradingPartner.id}`,
        kind: 'failingTradingPartner',
        whoActs: 'retry',
        tradingPartner: failing.tradingPartner,
        at: hoursAgo(3).toISOString(),
        delivered: 2,
        failed: 3,
        target: { kind: 'tradingPartner', tradingPartnerId: failing.tradingPartner.id },
      },
    ])
    expect(ofTradingPartner(tasks, degraded.tradingPartner.id, 'failingTradingPartner')).toEqual([])
  })

  it('lists only the tasks of the own Workspace and counts them by who acts', async () => {
    const { workspace: other, admin: otherAdmin } = await seedWorkspaceWithAdmin(
      api,
      'Sudhafen Logistik',
    )

    const partner = await addTradingPartner(other, 'Elbe Großhandel GmbH')
    const failed = await partner.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(1) })

    const { tasks, counts } = await listed(otherAdmin)

    expect(tasks.map(({ id }) => id)).toEqual([
      `run:${failed.id}`,
      `tradingPartner:${partner.tradingPartner.id}`,
    ])
    expect(counts).toEqual({ you: 0, retry: 2, tradingPartner: 0 })
  })
})
