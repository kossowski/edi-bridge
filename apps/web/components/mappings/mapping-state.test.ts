import { describe, expect, it } from 'vitest'

import { byState, filterCounts, mappingState, matchesFilter } from './mapping-state'

const live = { latestVersion: 2, failedRunsLast7Days: 0, unpublishedChanges: false }

const failing = { latestVersion: 2, failedRunsLast7Days: 3, unpublishedChanges: true }

const draft = { latestVersion: 2, failedRunsLast7Days: 0, unpublishedChanges: true }

const neverPublished = { latestVersion: null, failedRunsLast7Days: 0, unpublishedChanges: true }

describe('mappingState', () => {
  it('tells each state', () => {
    expect([live, failing, draft, neverPublished].map(mappingState)).toEqual([
      'live',
      'failing',
      'draft',
      'new',
    ])
  })
})

describe('byState', () => {
  it('puts failing first, then drafts, then never published, then live', () => {
    expect(byState([live, neverPublished, draft, failing])).toEqual([
      failing,
      draft,
      neverPublished,
      live,
    ])
  })
})

describe('filters', () => {
  it('counts failing and drafts as needing attention', () => {
    expect(filterCounts([live, failing, draft, neverPublished])).toEqual({
      all: 4,
      attention: 2,
      live: 1,
      new: 1,
    })
    expect(matchesFilter(draft, 'attention')).toBe(true)
    expect(matchesFilter(neverPublished, 'live')).toBe(false)
    expect(matchesFilter(neverPublished, 'all')).toBe(true)
  })
})
