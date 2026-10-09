import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import type { RunListQuery } from '@edi-bridge/contracts'

import {
  getCurrentWorkspace,
  getInterchange,
  getRun,
  listFlows,
  listMappingVersions,
  listRuns,
  listTradingPartners,
} from './client'

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})

export function runsQuery(query: RunListQuery) {
  return queryOptions({
    queryKey: ['runs', 'list', query],
    queryFn: () => listRuns(query),
    placeholderData: keepPreviousData,
  })
}

export function runQuery(id: string) {
  return queryOptions({
    queryKey: ['runs', 'detail', id],
    queryFn: () => getRun(id),
  })
}

export function interchangeQuery(id: string) {
  return queryOptions({
    queryKey: ['interchanges', 'detail', id],
    queryFn: () => getInterchange(id),
  })
}

export function mappingVersionsQuery(mappingId: string) {
  return queryOptions({
    queryKey: ['mappings', mappingId, 'versions'],
    queryFn: () => listMappingVersions(mappingId),
  })
}

export const tradingPartnersQuery = queryOptions({
  queryKey: ['trading-partners', 'list'],
  queryFn: listTradingPartners,
})

export const flowsQuery = queryOptions({
  queryKey: ['flows', 'list'],
  queryFn: listFlows,
})
