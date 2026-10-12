import type { MappingSummary } from '@edi-bridge/contracts'

type StateFacts = Pick<
  MappingSummary,
  'latestVersion' | 'failedRunsLast7Days' | 'unpublishedChanges'
>

export type MappingState = 'failing' | 'draft' | 'new' | 'live'

export type MappingFilter = 'all' | 'attention' | 'live' | 'new'

export const mappingFilters = [
  'all',
  'attention',
  'live',
  'new',
] as const satisfies ReadonlyArray<MappingFilter>

const stateRank = { failing: 0, draft: 1, new: 2, live: 3 } as const satisfies Record<
  MappingState,
  number
>

const filterOfState = {
  failing: 'attention',
  draft: 'attention',
  new: 'new',
  live: 'live',
} as const satisfies Record<MappingState, Exclude<MappingFilter, 'all'>>

export function mappingState(mapping: StateFacts): MappingState {
  if (mapping.latestVersion === null) {
    return 'new'
  }

  if (mapping.failedRunsLast7Days > 0) {
    return 'failing'
  }

  return mapping.unpublishedChanges ? 'draft' : 'live'
}

export function byState<Mapping extends StateFacts>(mappings: ReadonlyArray<Mapping>) {
  return mappings.toSorted(
    (left, right) => stateRank[mappingState(left)] - stateRank[mappingState(right)],
  )
}

export function matchesFilter(mapping: StateFacts, filter: MappingFilter) {
  return filter === 'all' || filterOfState[mappingState(mapping)] === filter
}

export function filterCounts(mappings: ReadonlyArray<StateFacts>) {
  const counts = { all: mappings.length, attention: 0, live: 0, new: 0 } satisfies Record<
    MappingFilter,
    number
  >

  for (const mapping of mappings) {
    counts[filterOfState[mappingState(mapping)]] += 1
  }

  return counts
}
