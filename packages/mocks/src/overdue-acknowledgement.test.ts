import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { interchangeEndpoint, toPath } from '@edi-bridge/contracts'

import { seedOverdueAcknowledgements } from './overdue-acknowledgement'
import { seedRuns } from './run'
import { runDetailHandlers } from './run-detail'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

// A busy CI runner takes seconds to build the 12,000 seeded Runs. Built once here, they stay out
// of the time limit of the first test that reads them.
beforeAll(() => {
  seedRuns()
})

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

afterAll(() => server.close())

describe('seedOverdueAcknowledgements', () => {
  it('links each one to the sent Interchange after the time limit of its Trading Partner', async () => {
    server.use(...runDetailHandlers(apiUrl))

    const overdueAcknowledgements = seedOverdueAcknowledgements()

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

  it('adds the sent Interchanges that became overdue later', () => {
    const runs = seedRuns()
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const before = seedOverdueAcknowledgements(runs)
    const after = seedOverdueAcknowledgements(runs, seedTradingPartners, later)
    const listedBefore = new Set(before.map(({ interchange }) => interchange.id))

    expect(after.some(({ interchange }) => !listedBefore.has(interchange.id))).toBe(true)
    expect(after.every(({ overdueSince }) => Date.parse(overdueSince) <= later.getTime())).toBe(
      true,
    )
  })
})
