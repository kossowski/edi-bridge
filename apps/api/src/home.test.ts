import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  homeEndpoint,
  homeSchema,
  type HomeWindow,
  type ThroughputBucket,
} from '@edi-bridge/contracts'

import { dayMs, hourMs, startOfUtcDay } from './duration.js'
import {
  addTradingPartnerWithFlows,
  type Client,
  failedRun,
  seedWorkspaceWithAdmin,
  startTestApi,
  type TestApi,
} from './testing.js'

let api: TestApi

const now = Date.now()

const hoursAgo = (hours: number) => new Date(now - hours * hourMs)

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const home = async (as: Client, window?: HomeWindow) => {
  const response = await as.inject({
    method: homeEndpoint.method,
    url: window === undefined ? homeEndpoint.path : `${homeEndpoint.path}?window=${window}`,
  })

  expect(response.statusCode, response.body).toBe(200)

  return homeSchema.parse(response.json())
}

describe('GET /home', () => {
  it('counts the key numbers, with delivered Runs in the chosen window', async () => {
    const { workspace, admin } = await seedWorkspaceWithAdmin(api, 'Nordwind Foods')
    const partner = await addTradingPartnerWithFlows(api.connection.db, workspace, 'Rheinkauf eG')

    // Enough deliveries that the partner stays short of failing, which would add a task.
    for (const hours of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      await partner.orders({ receivedAt: hoursAgo(hours) })
    }

    await partner.orders({ receivedAt: hoursAgo(50) })
    await partner.orders({ receivedAt: hoursAgo(10 * 24) })
    await partner.orders({ status: 'processing', receivedAt: hoursAgo(1) })
    await partner.orders({ status: 'received', receivedAt: hoursAgo(40) })
    await partner.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(3) })
    await partner.orders({ ...failedRun('mapping'), receivedAt: hoursAgo(4) })
    await partner.orders({ ...failedRun('parse'), receivedAt: hoursAgo(5) })

    const keyNumbers = { needsAttention: 2, inProgress: 2, waitingForTradingPartner: 1 }

    expect((await home(admin)).keyNumbers).toEqual({ ...keyNumbers, delivered: 10 })
    expect((await home(admin, '7d')).keyNumbers).toEqual({ ...keyNumbers, delivered: 11 })
    expect((await home(admin, '30d')).keyNumbers).toEqual({ ...keyNumbers, delivered: 12 })
  })

  it('counts finished Runs per hour in the last 24 hours and per day in longer windows', async () => {
    const { workspace, admin } = await seedWorkspaceWithAdmin(api, 'Ostsee Handel KG')
    const partner = await addTradingPartnerWithFlows(api.connection.db, workspace, 'Hafenmarkt')

    await partner.orders({ receivedAt: hoursAgo(0) })
    await partner.orders({ receivedAt: hoursAgo(0) })
    await partner.invoic({ ...failedRun('delivery'), receivedAt: hoursAgo(0) })
    await partner.orders({ receivedAt: hoursAgo(3) })
    await partner.orders({ status: 'processing', receivedAt: hoursAgo(3) })
    await partner.orders({ receivedAt: hoursAgo(3 * 24) })

    const bucketOf = (throughput: ThroughputBucket[], at: Date) =>
      throughput.find(
        ({ start, end }) => Date.parse(start) <= at.getTime() && at.getTime() < Date.parse(end),
      )

    const day = await home(admin)

    expect(day.throughput).toHaveLength(24)
    expect(day.to).toBe(day.throughput.at(-1)?.end)
    expect(day.from).toBe(day.throughput[0]?.start)
    expect(Date.parse(day.to) - Date.parse(day.from)).toBe(dayMs)
    expect(bucketOf(day.throughput, hoursAgo(0))).toMatchObject({ delivered: 2, failed: 1 })
    expect(bucketOf(day.throughput, hoursAgo(3))).toMatchObject({ delivered: 1, failed: 0 })
    expect(day.throughput.reduce((sum, { delivered }) => sum + delivered, 0)).toBe(3)

    const week = await home(admin, '7d')

    expect(week.throughput).toHaveLength(7)
    expect(Date.parse(week.throughput[0]?.end ?? '') - Date.parse(week.from)).toBe(dayMs)
    expect(bucketOf(week.throughput, hoursAgo(0))).toBe(week.throughput.at(-1))
    expect(bucketOf(week.throughput, hoursAgo(3 * 24))).toMatchObject({ delivered: 1, failed: 0 })

    expect((await home(admin, '30d')).throughput).toHaveLength(30)
  })

  it('lists each Trading Partner with its Documents today and open problems, most problems first', async () => {
    const { workspace, admin } = await seedWorkspaceWithAdmin(api, 'Elbe Großhandel GmbH')
    const db = api.connection.db
    const startOfToday = startOfUtcDay(now)

    const quiet = await addTradingPartnerWithFlows(db, workspace, 'Alpenfrisch Märkte AG')
    const busy = await addTradingPartnerWithFlows(db, workspace, 'Baltic Frische GmbH')
    const troubled = await addTradingPartnerWithFlows(db, workspace, 'Zeller Handel KG')

    await quiet.orders({ receivedAt: new Date(startOfToday.getTime() - hourMs) })

    for (const at of [startOfToday, new Date(now), new Date(now)]) {
      await busy.orders({ receivedAt: at })
    }

    await troubled.orders({ receivedAt: new Date(now) })
    await troubled.orders({ ...failedRun('mapping'), receivedAt: new Date(now) })
    await troubled.invoic({
      receivedAt: hoursAgo(31),
      handedOverAt: hoursAgo(30),
      controlReference: 17,
      acknowledgementState: 'overdue',
    })

    const card = (
      tradingPartner: { id: string; name: string },
      documentsToday: number,
      openProblems: number,
    ) => ({ tradingPartner, testMode: true, documentsToday, openProblems })

    expect((await home(admin)).tradingPartners).toEqual([
      card(troubled.tradingPartner, 2, 3),
      card(busy.tradingPartner, 3, 0),
      card(quiet.tradingPartner, 0, 0),
      {
        tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
        testMode: false,
        documentsToday: 0,
        openProblems: 0,
      },
    ])
  })

  it('answers 400 for an unknown window', async () => {
    const response = await api.admin.inject({
      method: homeEndpoint.method,
      url: `${homeEndpoint.path}?window=1y`,
    })

    expect(response.statusCode).toBe(400)
  })

  it('answers 401 without a session', async () => {
    const response = await api.app.inject({ method: homeEndpoint.method, url: homeEndpoint.path })

    expect(response.statusCode).toBe(401)
  })
})
