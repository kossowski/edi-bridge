import { describe, expect, it } from 'vitest'

import { errorRate, homeKeyNumbersOf, homeQuerySchema, homeSchema } from './home'

const tradingPartner = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }

describe('errorRate', () => {
  it('is the share of failed Runs among finished Runs', () => {
    expect(errorRate({ delivered: 45, failed: 5 })).toBe(0.1)
  })

  it('is null when no Run finished, so a chart shows a gap instead of 0 %', () => {
    expect(errorRate({ delivered: 0, failed: 0 })).toBeNull()
  })
})

describe('homeQuerySchema', () => {
  it('defaults to the last 24 hours', () => {
    expect(homeQuerySchema.parse({})).toEqual({ window: '24h' })
  })

  it.each(['24h', '7d', '30d'])('accepts the %s window', (window) => {
    expect(homeQuerySchema.parse({ window })).toEqual({ window })
  })

  it('rejects any other window', () => {
    expect(homeQuerySchema.safeParse({ window: '1h' }).success).toBe(false)
  })
})

describe('homeKeyNumbersOf', () => {
  it('counts tasks for you and to try again as needing attention, the rest as waiting', () => {
    expect(
      homeKeyNumbersOf({ you: 2, retry: 3, tradingPartner: 4 }, { delivered: 120, inProgress: 7 }),
    ).toEqual({ needsAttention: 5, delivered: 120, inProgress: 7, waitingForTradingPartner: 4 })
  })
})

describe('homeSchema', () => {
  const home = {
    window: '24h',
    from: '2026-10-09T13:00:00.000Z',
    to: '2026-10-10T13:00:00.000Z',
    keyNumbers: { needsAttention: 1, delivered: 2, inProgress: 0, waitingForTradingPartner: 0 },
    throughput: [
      {
        start: '2026-10-10T12:00:00.000Z',
        end: '2026-10-10T13:00:00.000Z',
        delivered: 2,
        failed: 1,
      },
    ],
    tradingPartners: [{ tradingPartner, testMode: true, documentsToday: 3, openProblems: 1 }],
  }

  it('parses a Home with key numbers, throughput and Trading Partner cards', () => {
    expect(homeSchema.parse(home)).toEqual(home)
  })

  it('rejects negative counts', () => {
    expect(
      homeSchema.safeParse({
        ...home,
        keyNumbers: { ...home.keyNumbers, delivered: -1 },
      }).success,
    ).toBe(false)
  })
})
