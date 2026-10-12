import { describe, expect, it } from 'vitest'

import {
  orderFiltersSearch,
  parseOrderFilters,
  statusFilterCount,
  toOrderLifecycleListQuery,
} from './order-filters'

describe('parseOrderFilters', () => {
  it('reads the search, the status and the page from the URL', () => {
    expect(parseOrderFilters(new URLSearchParams('q=4711&status=done&page=3'))).toEqual({
      q: '4711',
      status: 'done',
      page: 3,
    })
  })

  it('falls back to all orders on the first page for unknown values', () => {
    expect(parseOrderFilters(new URLSearchParams('status=late&page=0'))).toEqual({
      q: '',
      status: 'all',
      page: 1,
    })
  })
})

describe('orderFiltersSearch', () => {
  it('leaves the defaults out of the URL', () => {
    expect(orderFiltersSearch({ q: ' ', status: 'all', page: 1 })).toBe('')
    expect(orderFiltersSearch({ q: 'Alpen', status: 'needs-attention', page: 2 })).toBe(
      'q=Alpen&status=needs-attention&page=2',
    )
  })
})

describe('toOrderLifecycleListQuery', () => {
  it('asks for one status, or for every status when all are shown', () => {
    expect(toOrderLifecycleListQuery({ q: ' 4711 ', status: 'done', page: 2 })).toEqual({
      q: '4711',
      status: ['done'],
      page: 2,
      pageSize: 50,
    })
    expect(toOrderLifecycleListQuery({ q: '', status: 'all', page: 1 })).toMatchObject({
      q: undefined,
      status: undefined,
    })
  })
})

describe('statusFilterCount', () => {
  it('adds up every status for all orders', () => {
    const statusCounts = { 'on-track': 2, 'needs-attention': 1, done: 4 }

    expect(statusFilterCount(statusCounts, 'all')).toBe(7)
    expect(statusFilterCount(statusCounts, 'waiting-for-trading-partner')).toBe(0)
  })
})
