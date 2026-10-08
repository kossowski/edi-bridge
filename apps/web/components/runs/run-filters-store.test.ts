import { beforeEach, describe, expect, it } from 'vitest'

import { toRunListQuery, useRunFilters } from './run-filters-store'

beforeEach(() => useRunFilters.getState().clearFilters())

describe('toRunListQuery', () => {
  it('resolves a relative time range when the query is built, not when it was chosen', () => {
    useRunFilters.getState().setTimeRange({ timeRange: 'lastHour' })

    const query = toRunListQuery(useRunFilters.getState(), {
      now: new Date('2026-10-09T12:00:00.000Z'),
      timeZone: 'UTC',
    })

    expect(query.receivedFrom).toBe('2026-10-09T11:00:00.000Z')
    expect(query.receivedTo).toBeUndefined()
  })

  it('keeps the query stable within the same minute', () => {
    useRunFilters.getState().setTimeRange({ timeRange: 'last24Hours' })

    const state = useRunFilters.getState()

    const first = toRunListQuery(state, {
      now: new Date('2026-10-09T12:00:05.000Z'),
      timeZone: 'UTC',
    })

    const second = toRunListQuery(state, {
      now: new Date('2026-10-09T12:00:55.000Z'),
      timeZone: 'UTC',
    })

    expect(first).toEqual(second)
    expect(first.receivedFrom).toBe('2026-10-08T12:00:00.000Z')
  })

  it.each([
    [
      'Europe/Berlin',
      '2026-10-01',
      '2026-10-01',
      '2026-09-30T22:00:00.000Z',
      '2026-10-01T21:59:59.999Z',
    ],
    [
      'Europe/Berlin',
      '2026-10-25',
      '2026-10-25',
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T22:59:59.999Z',
    ],
    [
      'America/New_York',
      '2026-03-01',
      '2026-03-02',
      '2026-03-01T05:00:00.000Z',
      '2026-03-03T04:59:59.999Z',
    ],
    ['UTC', '2026-10-01', '2026-10-01', '2026-10-01T00:00:00.000Z', '2026-10-01T23:59:59.999Z'],
  ])(
    'reads custom dates as whole days in the display time zone %s (%s to %s)',
    (timeZone, customFrom, customTo, receivedFrom, receivedTo) => {
      useRunFilters.getState().setTimeRange({ timeRange: 'custom', customFrom, customTo })

      const query = toRunListQuery(useRunFilters.getState(), {
        now: new Date('2026-10-09T12:00:00.000Z'),
        timeZone,
      })

      expect(query.receivedFrom).toBe(receivedFrom)
      expect(query.receivedTo).toBe(receivedTo)
    },
  )
})
