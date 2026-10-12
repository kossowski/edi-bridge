import { describe, expect, it } from 'vitest'

import { errorRate, healthStatusOf } from './trading-partner-health'

describe('errorRate', () => {
  it('is the share of failed Runs among finished Runs', () => {
    expect(errorRate({ delivered: 45, failed: 5 })).toBe(0.1)
  })

  it('is null when no Run finished, so a chart shows a gap instead of 0 %', () => {
    expect(errorRate({ delivered: 0, failed: 0 })).toBeNull()
  })
})

describe('healthStatusOf', () => {
  it.each([
    ['no traffic', { delivered: 0, failed: 0, overdue: 0 }, 'healthy'],
    ['an error rate below 10 %', { delivered: 91, failed: 9, overdue: 0 }, 'healthy'],
    ['an error rate of 10 %', { delivered: 90, failed: 10, overdue: 0 }, 'degraded'],
    ['an Overdue Acknowledgement', { delivered: 100, failed: 0, overdue: 1 }, 'degraded'],
    ['an error rate of 25 %', { delivered: 75, failed: 25, overdue: 0 }, 'failing'],
    ['only failed Runs', { delivered: 0, failed: 3, overdue: 2 }, 'failing'],
  ] as const)('rates a Trading Partner with %s as %s', (_, counts, status) => {
    expect(healthStatusOf(counts)).toBe(status)
  })
})
