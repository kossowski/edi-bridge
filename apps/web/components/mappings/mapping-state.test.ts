import { describe, expect, it } from 'vitest'

import { byState, filterCounts, mappingState, matchesFilter } from './mapping-state'

const live = { latestVersion: 2, failedRunsLast7Days: 0, unpublishedChanges: false }

const failing = { latestVersion: 2, failedRunsLast7Days: 3, unpublishedChanges: true }

const draft = { latestVersion: 2, failedRunsLast7Days: 0, unpublishedChanges: true }

const fresh = { latestVersion: null, failedRunsLast7Days: 0, unpublishedChanges: true }

describe('mappingState', () => {
  it('tells each state', () => {
    expect([live, failing, draft, fresh].map(mappingState)).toEqual([
      'live',
      'failing',
      'draft',
      'new',
    ])
  })
})

describe('byState', () => {
  it('puts failing first, then drafts, then never published, then live', () => {
    expect(byState([live, fresh, draft, failing])).toEqual([failing, draft, fresh, live])
  })
})

describe('filters', () => {
  it('counts failing and drafts as needing attention', () => {
    expect(filterCounts([live, failing, draft, fresh])).toEqual({
      all: 4,
      attention: 2,
      live: 1,
      new: 1,
    })
    expect(matchesFilter(draft, 'attention')).toBe(true)
    expect(matchesFilter(fresh, 'live')).toBe(false)
    expect(matchesFilter(fresh, 'all')).toBe(true)
  })
})
